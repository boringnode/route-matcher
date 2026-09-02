/*
 * Portions derived from @adonisjs/http-server.
 * Copyright (c) 2023 Harminder Virk. Licensed under the MIT License.
 */

import { stripRouteSeparators } from './route_parser.ts'
import type {
  RouteMatch,
  RouteParams,
  RoutePrecedence,
  RouteTableOptions,
  RouteToken,
  RouteTokenType,
} from './types.ts'

type IndexedRoute<T> = {
  additionalMatcherChecks?: { index: number; matcher: RegExp }[]
  isStructurallyMatched?: boolean
  matcher?: RegExp
  matcherSegmentIndex?: number
  order: number
  tokens: RouteToken[]
  value: T
}

type RouteNode<T> = {
  literals?: Map<string, RouteNode<T>>
  minimumOrder: number
  optionals?: Map<string, RouteNode<T>>
  parameters?: Map<string, RouteNode<T>>
  terminals?: IndexedRoute<T>[]
  wildcards?: IndexedRoute<T>[]
}

function createNode<T>(): RouteNode<T> {
  return { minimumOrder: Number.POSITIVE_INFINITY }
}

function splitRoutePath(pathname: string): string[] {
  pathname = stripRouteSeparators(pathname)
  return pathname === '/' ? ['/'] : pathname.split('/')
}

function getStaticRouteKey(tokens: RouteToken[]): string | null {
  if (!tokens.length || tokens.some((token) => token.type !== 0)) {
    return null
  }

  return tokens.length === 1 && tokens[0].val === '/'
    ? 'root'
    : `segments:${tokens.map((token) => token.val).join('/')}`
}

function getStaticRequestKey(pathname: string): string {
  pathname = stripRouteSeparators(pathname)
  return pathname === '/' ? 'root' : `segments:${pathname}`
}

function getOrCreateChild<T>(children: Map<string, RouteNode<T>>, key: string): RouteNode<T> {
  let child = children.get(key)
  if (!child) {
    child = createNode<T>()
    children.set(key, child)
  }
  return child
}

function getTokenSpecificity(type: RouteTokenType): number {
  if (type === 0) return 3
  if (type === 1) return 2
  if (type === 3) return 1
  return 0
}

function compareRouteSpecificity(a: RouteToken[], b: RouteToken[]): number {
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index++) {
    const aSpecificity = a[index] ? getTokenSpecificity(a[index].type) : -1
    const bSpecificity = b[index] ? getTokenSpecificity(b[index].type) : -1
    if (aSpecificity !== bSpecificity) {
      return bSpecificity - aSpecificity
    }
  }
  return 0
}

function matchesSegment(token: RouteToken, segment: string | undefined): boolean {
  if (token.type === 0) {
    return token.val === segment
  }
  if (segment === '/') {
    return token.type > 1
  }
  if (segment === '') {
    return token.end === '' && (token.matcher ? token.matcher.test(segment) : true)
  }
  if (!segment) {
    return token.end === ''
  }
  return segment.endsWith(token.end) && (token.matcher ? token.matcher.test(segment) : true)
}

function matchesRoute(tokens: RouteToken[], segments: string[]): boolean {
  if (!tokens.length) {
    return segments.length === 1 && segments[0] === '/'
  }

  if (
    tokens.length !== segments.length &&
    !(tokens.length < segments.length && tokens[tokens.length - 1].type === 2) &&
    !(tokens.length > segments.length && tokens[tokens.length - 1].type === 3)
  ) {
    return false
  }

  let index = 0
  while (index < tokens.length) {
    if (!matchesSegment(tokens[index], segments[index])) {
      return false
    }
    index++
  }

  return true
}

function matchesIndexedRoute<T>(route: IndexedRoute<T>, segments: string[]): boolean {
  if (!route.isStructurallyMatched) {
    return matchesRoute(route.tokens, segments)
  }

  const matcher = route.matcher
  if (matcher) {
    const segment = segments[route.matcherSegmentIndex!]
    if (segment !== undefined && segment !== '/' && !matcher.test(segment)) {
      return false
    }
  }

  for (const { index, matcher: additionalMatcher } of route.additionalMatcherChecks ?? []) {
    const segment = segments[index]
    if (segment !== undefined && segment !== '/' && !additionalMatcher.test(segment)) {
      return false
    }
  }
  return true
}

export function extractRouteParams(
  tokens: RouteToken[],
  pathname: string,
  shouldDecodeParams: boolean = false
): RouteParams {
  const segments = splitRoutePath(pathname)
  const params: RouteParams = {}
  let index = 0

  while (index < tokens.length) {
    const token = tokens[index]
    const segment = segments[index]

    if (segment === '/') {
      index++
      continue
    }

    if (token.val === '*') {
      params[token.val] = segments.slice(index).map((value) => {
        if (!shouldDecodeParams) {
          return value
        }
        try {
          return decodeURIComponent(value)
        } catch {
          return value
        }
      })
      break
    }

    if (segment === undefined || token.type === 0) {
      index++
      continue
    }

    let value = segment.replace(token.end, '')
    if (shouldDecodeParams) {
      try {
        value = decodeURIComponent(value)
      } catch {}
    }
    params[token.val] = token.cast ? token.cast(value) : value
    index++
  }

  return params
}

/** Matches a transient list of tokenized routes without building an index. */
export function matchRouteTokens(
  pathname: string,
  routes: RouteToken[][],
  shouldDecodeParams: boolean = false
): RouteParams | null {
  const segments = splitRoutePath(pathname)
  for (const tokens of routes) {
    if (matchesRoute(tokens, segments)) {
      return extractRouteParams(tokens, pathname, shouldDecodeParams)
    }
  }
  return null
}

/** An indexed route matcher with configurable precedence. */
export class RouteTable<T> {
  #nextOrder = 0
  #precedence: RoutePrecedence
  #root = createNode<T>()
  #staticRoutes = new Map<string, IndexedRoute<T>>()
  #unindexedRoutes: IndexedRoute<T>[] = []

  constructor(options: RouteTableOptions = {}) {
    this.#precedence = options.precedence ?? 'registration'
  }

  add(tokens: RouteToken[], value: T): this {
    const indexedRoute: IndexedRoute<T> = { order: this.#nextOrder++, tokens, value }
    const staticKey = getStaticRouteKey(tokens)

    if (staticKey !== null) {
      if (!this.#staticRoutes.has(staticKey)) {
        this.#staticRoutes.set(staticKey, indexedRoute)
      }
      return this
    }

    const hasStatefulMatcher = tokens.some((token, index) => {
      const matcher = token.matcher
      const isStateful =
        matcher &&
        (matcher.global ||
          matcher.sticky ||
          matcher.exec !== RegExp.prototype.exec ||
          matcher.test !== RegExp.prototype.test)
      if (isStateful) {
        return true
      }
      if (matcher) {
        if (!indexedRoute.matcher) {
          indexedRoute.matcher = matcher
          indexedRoute.matcherSegmentIndex = index
        } else {
          indexedRoute.additionalMatcherChecks ||= []
          indexedRoute.additionalMatcherChecks.push({ index, matcher })
        }
      }
      return false
    })

    if (!tokens.length || hasStatefulMatcher) {
      this.#insertCandidate(this.#unindexedRoutes, indexedRoute)
      return this
    }

    let node = this.#root
    node.minimumOrder = Math.min(node.minimumOrder, indexedRoute.order)
    for (const token of tokens) {
      if (token.type === 0) {
        node.literals ||= new Map()
        node = getOrCreateChild(node.literals, token.val)
      } else if (token.type === 1) {
        node.parameters ||= new Map()
        node = getOrCreateChild(node.parameters, token.end)
      } else if (token.type === 3) {
        node.optionals ||= new Map()
        node = getOrCreateChild(node.optionals, token.end)
      } else {
        node.wildcards ||= []
        this.#insertCandidate(node.wildcards, indexedRoute)
        return this
      }
      node.minimumOrder = Math.min(node.minimumOrder, indexedRoute.order)
    }

    node.terminals ||= []
    indexedRoute.isStructurallyMatched = true
    this.#insertCandidate(node.terminals, indexedRoute)
    return this
  }

  match(pathname: string, shouldDecodeParams: boolean = false): RouteMatch<T> | null {
    const staticRoute = this.#staticRoutes.get(getStaticRequestKey(pathname))
    const registrationPrecedence = this.#precedence === 'registration'
    const cutoff = registrationPrecedence
      ? (staticRoute?.order ?? Number.POSITIVE_INFINITY)
      : Number.POSITIVE_INFINITY
    const firstUnindexedRoute = this.#unindexedRoutes[0]
    if (
      registrationPrecedence &&
      staticRoute &&
      this.#root.minimumOrder >= cutoff &&
      (!firstUnindexedRoute || firstUnindexedRoute.order >= cutoff)
    ) {
      return { value: staticRoute.value, params: {} }
    }

    const segments = splitRoutePath(pathname)
    const candidateLists: IndexedRoute<T>[][] = []
    if (firstUnindexedRoute && (!registrationPrecedence || firstUnindexedRoute.order < cutoff)) {
      candidateLists.push(this.#unindexedRoutes)
    }
    this.#collectCandidates(this.#root, segments, 0, cutoff, candidateLists)
    if (!registrationPrecedence && staticRoute) {
      candidateLists.push([staticRoute])
    }

    const candidate =
      candidateLists.length === 1
        ? this.#findCandidateInList(candidateLists[0], segments, cutoff)
        : this.#findCandidateAcrossLists(candidateLists, segments, cutoff)
    if (candidate) {
      return {
        value: candidate.value,
        params: extractRouteParams(candidate.tokens, pathname, shouldDecodeParams),
      }
    }
    return registrationPrecedence && staticRoute ? { value: staticRoute.value, params: {} } : null
  }

  #findCandidateInList(
    candidates: IndexedRoute<T>[],
    segments: string[],
    cutoff: number
  ): IndexedRoute<T> | undefined {
    for (const candidate of candidates) {
      if (candidate.order >= cutoff) {
        break
      }
      if (matchesIndexedRoute(candidate, segments)) {
        return candidate
      }
    }
    return undefined
  }

  #findCandidateAcrossLists(
    candidateLists: IndexedRoute<T>[][],
    segments: string[],
    cutoff: number
  ): IndexedRoute<T> | undefined {
    const positions = new Uint32Array(candidateLists.length)
    while (true) {
      let selectedList = -1
      let selectedRoute: IndexedRoute<T> | undefined
      for (const [listIndex, candidates] of candidateLists.entries()) {
        const candidate = candidates[positions[listIndex]]
        if (candidate && (!selectedRoute || this.#compareRoutes(candidate, selectedRoute) < 0)) {
          selectedList = listIndex
          selectedRoute = candidate
        }
      }

      if (!selectedRoute || selectedRoute.order >= cutoff) {
        return undefined
      }
      positions[selectedList]++

      if (matchesIndexedRoute(selectedRoute, segments)) {
        return selectedRoute
      }
    }
  }

  #compareRoutes(a: IndexedRoute<T>, b: IndexedRoute<T>): number {
    if (this.#precedence === 'specificity') {
      const specificity = compareRouteSpecificity(a.tokens, b.tokens)
      if (specificity !== 0) return specificity
    }
    return a.order - b.order
  }

  #insertCandidate(candidates: IndexedRoute<T>[], route: IndexedRoute<T>): void {
    if (this.#precedence === 'registration') {
      candidates.push(route)
      return
    }

    let start = 0
    let end = candidates.length
    while (start < end) {
      const middle = (start + end) >>> 1
      if (this.#compareRoutes(candidates[middle], route) <= 0) {
        start = middle + 1
      } else {
        end = middle
      }
    }
    candidates.splice(start, 0, route)
  }

  #collectCandidates(
    node: RouteNode<T>,
    segments: string[],
    segmentIndex: number,
    cutoff: number,
    candidateLists: IndexedRoute<T>[][],
    canMatchTerminal: boolean = true
  ): void {
    if (node.minimumOrder >= cutoff) {
      return
    }

    const wildcards = node.wildcards
    if (wildcards?.length && wildcards[0].order < cutoff) {
      candidateLists.push(wildcards)
    }

    if (segmentIndex === segments.length) {
      this.#collectTerminalCandidates(
        node,
        segments,
        segmentIndex,
        cutoff,
        candidateLists,
        canMatchTerminal
      )
      return
    }

    const segment = segments[segmentIndex]
    this.#collectSegmentCandidates(node, segments, segmentIndex, segment, cutoff, candidateLists)
  }

  #collectTerminalCandidates(
    node: RouteNode<T>,
    segments: string[],
    segmentIndex: number,
    cutoff: number,
    candidateLists: IndexedRoute<T>[][],
    canMatchTerminal: boolean
  ): void {
    const terminals = node.terminals
    if (canMatchTerminal && terminals?.length && terminals[0].order < cutoff) {
      candidateLists.push(terminals)
    }
    for (const [suffix, optionalChild] of node.optionals ?? []) {
      if (suffix === '') {
        this.#collectCandidates(optionalChild, segments, segmentIndex, cutoff, candidateLists)
      }
    }
    for (const [suffix, parameterChild] of node.parameters ?? []) {
      if (suffix === '') {
        this.#collectCandidates(
          parameterChild,
          segments,
          segmentIndex,
          cutoff,
          candidateLists,
          false
        )
      }
    }
  }

  #collectSegmentCandidates(
    node: RouteNode<T>,
    segments: string[],
    segmentIndex: number,
    segment: string,
    cutoff: number,
    candidateLists: IndexedRoute<T>[][]
  ): void {
    const literalChild = node.literals?.get(segment)
    if (literalChild) {
      this.#collectCandidates(literalChild, segments, segmentIndex + 1, cutoff, candidateLists)
    }
    if (segment !== '/') {
      for (const [suffix, parameterChild] of node.parameters ?? []) {
        if (segment.endsWith(suffix)) {
          this.#collectCandidates(
            parameterChild,
            segments,
            segmentIndex + 1,
            cutoff,
            candidateLists
          )
        }
      }
    }
    for (const [suffix, optionalChild] of node.optionals ?? []) {
      if (segment === '/' || segment.endsWith(suffix)) {
        this.#collectCandidates(optionalChild, segments, segmentIndex + 1, cutoff, candidateLists)
      }
    }
  }
}
