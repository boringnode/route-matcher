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
  /**
   * Static routes only. True when another route could win this pathname or
   * run a matcher before it, so lookups take the full search. Computed by the
   * first lookup or prepare(), and cleared when a later route may change the answer.
   */
  isShadowed?: boolean
  isStructurallyMatched?: boolean
  matcher?: RegExp
  matcherSegmentIndex?: number
  order: number
  parameterIndexes: number[]
  specificityRank: string
  tokens: RouteToken[]
  value: T
}

/** A parameter edge, keyed by the suffix its segments must end with. */
type RouteBranch<T> = { node: RouteNode<T>; suffix: string }

type RouteNode<T> = {
  literals?: Map<string, RouteNode<T>>
  minimumOrder: number
  optionals?: RouteBranch<T>[]
  parameters?: RouteBranch<T>[]
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

function isStaticRoute(tokens: RouteToken[]): boolean {
  return tokens.length > 0 && tokens.every((token) => token.type === 0)
}

function isRootRoute(tokens: RouteToken[]): boolean {
  return tokens.length === 1 && tokens[0].type === 0 && tokens[0].val === '/'
}

/**
 * Static routes are keyed by the normalized pathname they answer, so lookups
 * hash the request without building a key. Only the root route answers "/":
 * other tokens joining to "/" are unreachable and return null.
 */
function getStaticRouteKey(tokens: RouteToken[]): string | null {
  if (isRootRoute(tokens)) {
    return '/'
  }
  const key = tokens.map((token) => token.val).join('/')
  return key === '/' ? null : key
}

/**
 * Like `matchesRoute`, but answers whether a lookup could match the route or
 * run one of its matchers, without running them.
 */
function mayMatchOrRunMatcher(tokens: RouteToken[], segments: string[]): boolean {
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

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    const segment = segments[index]
    if (token.type === 0) {
      if (token.val !== segment) return false
    } else if (segment === '/') {
      if (token.type <= 1) return false
    } else if (segment === '') {
      if (token.end !== '') return false
      if (token.matcher) return true
    } else if (!segment) {
      if (token.end !== '') return false
    } else {
      if (!segment.endsWith(token.end)) return false
      if (token.matcher) return true
    }
  }
  return true
}

function getOrCreateChild<T>(children: Map<string, RouteNode<T>>, key: string): RouteNode<T> {
  let child = children.get(key)
  if (!child) {
    child = createNode<T>()
    children.set(key, child)
  }
  return child
}

function getOrCreateBranch<T>(branches: RouteBranch<T>[], suffix: string): RouteNode<T> {
  for (const branch of branches) {
    if (branch.suffix === suffix) return branch.node
  }
  const node = createNode<T>()
  branches.push({ node, suffix })
  return node
}

function getTokenSpecificity(type: RouteTokenType): number {
  if (type === 0) return 3
  if (type === 1) return 2
  if (type === 3) return 1
  return 0
}

/**
 * Encodes specificity so that comparing two ranks as strings compares routes
 * segment by segment: "0" static, "1" required, "2" optional, "3" wildcard,
 * and "4" for a missing token. Trailing "4"s are implied by the "5" ending.
 */
function getSpecificityRank(tokens: RouteToken[]): string {
  let rank = ''
  for (let index = 0; index < tokens.length; index++) {
    rank += tokens[index] ? 3 - getTokenSpecificity(tokens[index].type) : 4
  }
  return `${rank.replace(/4+$/, '')}5`
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

const NO_PARAMETER_INDEXES: number[] = []

/** Indexes of the tokens that produce parameters, computed once per route. */
function getParameterIndexes(tokens: RouteToken[]): number[] {
  let indexes: number[] | undefined
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].type !== 0 || tokens[index].val === '*') {
      ;(indexes ||= []).push(index)
    }
  }
  return indexes ?? NO_PARAMETER_INDEXES
}

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Only tokens that can produce parameters are visited, including hand-built
 * static tokens named "*". A suffix is removed at its first occurrence.
 */
function extractRouteParamsFromSegments(
  tokens: RouteToken[],
  parameterIndexes: number[],
  segments: string[],
  shouldDecodeParams: boolean
): RouteParams {
  const params: RouteParams = {}

  for (let position = 0; position < parameterIndexes.length; position++) {
    const index = parameterIndexes[position]
    const token = tokens[index]
    const segment = segments[index]

    if (segment === '/') {
      continue
    }

    if (token.val === '*') {
      params[token.val] = segments
        .slice(index)
        .map((value) => (shouldDecodeParams ? decodeParam(value) : value))
      break
    }

    if (segment === undefined) {
      continue
    }

    let value = token.end === '' ? segment : segment.replace(token.end, '')
    if (shouldDecodeParams) {
      value = decodeParam(value)
    }
    params[token.val] = token.cast ? token.cast(value) : value
  }

  return params
}

export function extractRouteParams(
  tokens: RouteToken[],
  pathname: string,
  shouldDecodeParams: boolean = false
): RouteParams {
  return extractRouteParamsFromSegments(
    tokens,
    getParameterIndexes(tokens),
    splitRoutePath(pathname),
    shouldDecodeParams
  )
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
      return extractRouteParamsFromSegments(
        tokens,
        getParameterIndexes(tokens),
        segments,
        shouldDecodeParams
      )
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
  /**
   * One bit per (key length, last character) pair seen among static keys, so
   * most dynamic pathnames skip hashing into `#staticRoutes`.
   */
  #staticKeyFilter = new Uint32Array(64)
  #unindexedRoutes: IndexedRoute<T>[] = []

  constructor(options: RouteTableOptions = {}) {
    this.#precedence = options.precedence ?? 'registration'
  }

  add(tokens: RouteToken[], value: T): this {
    const indexedRoute: IndexedRoute<T> = {
      order: this.#nextOrder++,
      parameterIndexes: getParameterIndexes(tokens),
      specificityRank: this.#precedence === 'specificity' ? getSpecificityRank(tokens) : '',
      tokens,
      value,
    }

    if (isStaticRoute(tokens)) {
      const staticKey = getStaticRouteKey(tokens)
      if (staticKey !== null && !this.#staticRoutes.has(staticKey)) {
        // Hand-built tokens holding "/" or "*" keep the full search, as before.
        if (
          (!isRootRoute(tokens) && tokens.some((token) => token.val.includes('/'))) ||
          indexedRoute.parameterIndexes.length > 0
        ) {
          indexedRoute.isShadowed = true
        }
        this.#staticRoutes.set(staticKey, indexedRoute)
        this.#staticKeyFilter[staticKey.length & 63] |=
          1 << (staticKey.charCodeAt(staticKey.length - 1) & 31)
      }
      return this
    }

    this.#indexDynamicRoute(indexedRoute)
    this.#shadowStaticRoutes(tokens)
    return this
  }

  match(pathname: string, shouldDecodeParams: boolean = false): RouteMatch<T> | null {
    const normalizedPathname = stripRouteSeparators(pathname)
    const length = normalizedPathname.length
    const staticRoute =
      this.#staticKeyFilter[length & 63] & (1 << (normalizedPathname.charCodeAt(length - 1) & 31))
        ? this.#staticRoutes.get(normalizedPathname)
        : undefined
    if (staticRoute) {
      staticRoute.isShadowed ??= this.#isStaticRouteShadowed(staticRoute, normalizedPathname)
      if (!staticRoute.isShadowed) {
        return { value: staticRoute.value, params: {} }
      }
    }

    const registrationPrecedence = this.#precedence === 'registration'
    const cutoff = registrationPrecedence
      ? (staticRoute?.order ?? Number.POSITIVE_INFINITY)
      : Number.POSITIVE_INFINITY
    const firstUnindexedRoute = this.#unindexedRoutes[0]

    const segments = normalizedPathname === '/' ? ['/'] : normalizedPathname.split('/')
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
        params: extractRouteParamsFromSegments(
          candidate.tokens,
          candidate.parameterIndexes,
          segments,
          shouldDecodeParams
        ),
      }
    }
    return registrationPrecedence && staticRoute ? { value: staticRoute.value, params: {} } : null
  }

  /**
   * Prepares static lookup shortcuts after registration, without running matchers
   * or casts. Optional: match() prepares them lazily otherwise. Later additions
   * remain supported; invalidated shortcuts are prepared by match() or prepare().
   */
  prepare(): this {
    for (const [staticKey, staticRoute] of this.#staticRoutes) {
      staticRoute.isShadowed ??= this.#isStaticRouteShadowed(staticRoute, staticKey)
    }
    return this
  }

  #indexDynamicRoute(indexedRoute: IndexedRoute<T>): void {
    const tokens = indexedRoute.tokens
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
      return
    }

    let node = this.#root
    node.minimumOrder = Math.min(node.minimumOrder, indexedRoute.order)
    for (const token of tokens) {
      if (token.type === 0) {
        node.literals ||= new Map()
        node = getOrCreateChild(node.literals, token.val)
      } else if (token.type === 1) {
        node.parameters ||= []
        node = getOrCreateBranch(node.parameters, token.end)
      } else if (token.type === 3) {
        node.optionals ||= []
        node = getOrCreateBranch(node.optionals, token.end)
      } else {
        node.wildcards ||= []
        this.#insertCandidate(node.wildcards, indexedRoute)
        return
      }
      node.minimumOrder = Math.min(node.minimumOrder, indexedRoute.order)
    }

    node.terminals ||= []
    indexedRoute.isStructurallyMatched = true
    this.#insertCandidate(node.terminals, indexedRoute)
  }

  /**
   * Whether a lookup for this static route's pathname would evaluate another
   * route first: one that ranks before it and could match or run a matcher.
   */
  #isStaticRouteShadowed(staticRoute: IndexedRoute<T>, staticKey: string): boolean {
    const segments = staticKey === '/' ? ['/'] : staticKey.split('/')
    const cutoff =
      this.#precedence === 'registration' ? staticRoute.order : Number.POSITIVE_INFINITY
    const candidateLists: IndexedRoute<T>[][] = [this.#unindexedRoutes]
    this.#collectCandidates(this.#root, segments, 0, cutoff, candidateLists)
    return candidateLists.some((candidates) =>
      candidates.some((candidate) => this.#shadowsStaticRoute(candidate, staticRoute, segments))
    )
  }

  #shadowsStaticRoute(
    candidate: IndexedRoute<T>,
    staticRoute: IndexedRoute<T>,
    segments: string[]
  ): boolean {
    return (
      this.#compareRoutes(candidate, staticRoute) < 0 &&
      (candidate.isStructurallyMatched === true || mayMatchOrRunMatcher(candidate.tokens, segments))
    )
  }

  /**
   * Under specificity, a later dynamic route can outrank an existing static
   * route only by repeating all of its segments and ending with an optional
   * parameter, so only static routes named by its static prefixes are reset
   * for the next lookup to recompute. Static segments containing "/" reset all.
   */
  #shadowStaticRoutes(tokens: RouteToken[]): void {
    if (this.#precedence === 'registration' || !this.#staticRoutes.size) {
      return
    }

    if (tokens.some((token) => token.type === 0 && token.val.includes('/'))) {
      for (const staticRoute of this.#staticRoutes.values()) {
        if (staticRoute.isShadowed === false) staticRoute.isShadowed = undefined
      }
      return
    }
    if (tokens[tokens.length - 1]?.type !== 3) {
      return
    }

    let staticKey = ''
    for (let index = 0; index < tokens.length && tokens[index].type === 0; index++) {
      staticKey = index === 0 ? tokens[0].val : `${staticKey}/${tokens[index].val}`
      const staticRoute = this.#staticRoutes.get(staticKey)
      if (staticRoute?.isShadowed === false) {
        staticRoute.isShadowed = undefined
      }
    }
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
    if (a.specificityRank !== b.specificityRank) {
      return a.specificityRank < b.specificityRank ? -1 : 1
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
    const optionals = node.optionals
    if (optionals) {
      for (let index = 0; index < optionals.length; index++) {
        if (optionals[index].suffix === '') {
          this.#collectCandidates(
            optionals[index].node,
            segments,
            segmentIndex,
            cutoff,
            candidateLists
          )
        }
      }
    }
    const parameters = node.parameters
    if (parameters) {
      for (let index = 0; index < parameters.length; index++) {
        if (parameters[index].suffix === '') {
          this.#collectCandidates(
            parameters[index].node,
            segments,
            segmentIndex,
            cutoff,
            candidateLists,
            false
          )
        }
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
    const parameters = node.parameters
    if (parameters && segment !== '/') {
      for (let index = 0; index < parameters.length; index++) {
        if (segment.endsWith(parameters[index].suffix)) {
          this.#collectCandidates(
            parameters[index].node,
            segments,
            segmentIndex + 1,
            cutoff,
            candidateLists
          )
        }
      }
    }
    const optionals = node.optionals
    if (optionals) {
      for (let index = 0; index < optionals.length; index++) {
        if (segment === '/' || segment.endsWith(optionals[index].suffix)) {
          this.#collectCandidates(
            optionals[index].node,
            segments,
            segmentIndex + 1,
            cutoff,
            candidateLists
          )
        }
      }
    }
  }
}
