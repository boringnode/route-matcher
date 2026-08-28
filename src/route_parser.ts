/*
 * Portions derived from @adonisjs/http-server.
 * Copyright (c) 2023 Harminder Virk. Licensed under the MIT License.
 */

import type { RouteMatchers, RouteToken } from './types.ts'

export function stripRouteSeparators(value: string): string {
  if (value === '/') {
    return value
  }
  if (value.charCodeAt(0) === 47) {
    value = value.substring(1)
  }

  const lastIndex = value.length - 1
  return value.charCodeAt(lastIndex) === 47 ? value.substring(0, lastIndex) : value
}

/**
 * Parses a route pattern into tokens. A single leading and trailing separator
 * is stripped for compatibility with established route pattern semantics.
 */
export function parseRoute(pattern: string, matchers: RouteMatchers = {}): RouteToken[] {
  if (pattern === '/') {
    return [{ old: pattern, type: 0, val: pattern, end: '' }]
  }

  if (typeof matchers !== 'object') {
    matchers = {}
  }

  let remaining = stripRouteSeparators(pattern)
  let index = -1
  let parameterNameEnd = 0
  let segmentStart = 0
  let remainingLength = remaining.length
  const tokens: RouteToken[] = []

  while (++index < remainingLength) {
    let character = remaining.charCodeAt(index)

    if (character === 58) {
      segmentStart = index + 1
      let type: 1 | 3 = 1
      parameterNameEnd = 0
      let suffix = ''

      while (index < remainingLength && remaining.charCodeAt(index) !== 47) {
        character = remaining.charCodeAt(index)
        if (character === 63) {
          parameterNameEnd = index
          type = 3
        } else if (character === 46 && suffix.length === 0) {
          parameterNameEnd = index
          suffix = remaining.substring(index)
        }
        index++
      }

      const value = remaining.substring(segmentStart, parameterNameEnd || index)
      const matcher = matchers[value]
      tokens.push({
        old: pattern,
        type,
        val: value,
        end: suffix,
        matcher: matcher?.match,
        cast: matcher?.cast,
      })

      remaining = remaining.substring(index)
      remainingLength -= index
      index = 0
      continue
    }

    if (character === 42) {
      tokens.push({
        old: pattern,
        type: 2,
        val: remaining.substring(index),
        end: '',
      })
      continue
    }

    segmentStart = index
    while (index < remainingLength && remaining.charCodeAt(index) !== 47) {
      index++
    }

    const value = remaining.substring(segmentStart, index)
    tokens.push({ old: pattern, type: 0, val: value, end: '' })
    remaining = remaining.substring(index)
    remainingLength -= index
    index = segmentStart = 0
  }

  return tokens
}
