/*
 * Compatibility vectors adapted from the MIT-licensed test suites at
 * https://github.com/lukeed/matchit and https://github.com/poppinss/matchit.
 */

// @ts-expect-error @poppinss/matchit does not publish TypeScript declarations
import matchit from '@poppinss/matchit'
import { test } from '@japa/runner'

import { extractRouteParams, parseRoute, RouteTable } from '../index.ts'
import type { RouteMatchers } from '../index.ts'

type RouteDefinition = {
  matchers?: RouteMatchers
  pattern: string
}

function matchWithOracle(
  pathname: string,
  definitions: RouteDefinition[],
  shouldDecodeParams: boolean = false
) {
  const tokenLists = definitions.map(({ pattern, matchers }) => {
    const tokens = matchit.parse(pattern, matchers)
    // Empty patterns intentionally behave like root without inheriting the oracle's empty-token crash.
    return tokens.length ? tokens : [{ old: pattern, type: 0, val: '/', end: '' }]
  })
  const matchedTokens = matchit.match(pathname, tokenLists)
  if (!matchedTokens.length) {
    return null
  }

  return {
    params: matchit.exec(pathname, matchedTokens, shouldDecodeParams),
    pattern: matchedTokens[0].old,
  }
}

function matchWithRouteTable(
  pathname: string,
  definitions: RouteDefinition[],
  shouldDecodeParams: boolean = false
) {
  const table = new RouteTable<string>()
  for (const { pattern, matchers } of definitions) {
    table.add(parseRoute(pattern, matchers), pattern)
  }

  const match = table.match(pathname, shouldDecodeParams)
  return match ? { params: match.params, pattern: match.value } : null
}

test.group('Compatibility', () => {
  test('parses upstream pattern vectors', ({ assert }) => {
    const patterns = [
      '',
      '/',
      '/about',
      'contact',
      '/foobar',
      '/:foo',
      'books/:title',
      '/foo/:bar',
      '/:foo.bar',
      'books/:title.jpg',
      '/foo/:bar.html',
      '/foo/:bar/:baz',
      '/foo/bar/:baz',
      '/foo/bar/:baz/:bat',
      '/:foo?',
      'foo/:bar?',
      '/foo/:bar?/:baz?',
      '*',
      '/*',
      'foo/*',
      'foo/bar/*',
    ]

    for (const pattern of patterns) {
      assert.deepEqual(parseRoute(pattern), matchit.parse(pattern), pattern)
    }
  })

  test('matches upstream pathname vectors', ({ assert }) => {
    const definitions = [
      '/',
      '/about',
      'contact',
      '/books',
      '/books/:title',
      '/foo/*',
      'bar/:baz/:bat?',
      '/videos/:title.mp4',
    ].map((pattern) => ({ pattern }))
    const cases = [
      ['/', '/'],
      ['/about', '/about'],
      ['contact', 'contact'],
      ['about', '/about'],
      ['/contact', 'contact'],
      ['/books/', '/books'],
      ['/books/foobar', '/books/:title'],
      ['/books/foo/bar', null],
      ['/hello/world', null],
      ['/videos/buckbunny.mp4', '/videos/:title.mp4'],
      ['/videos/buckbunny', null],
      ['/bar/hello', 'bar/:baz/:bat?'],
      ['/bar/hello/world', 'bar/:baz/:bat?'],
      ['/books/narnia?author=lukeed', '/books/:title'],
      ['/foo/bar', '/foo/*'],
      ['/foo/bar/baz', '/foo/*'],
    ] as const

    for (const [pathname, expected] of cases) {
      const oracle = matchWithOracle(pathname, definitions)
      const actual = matchWithRouteTable(pathname, definitions)
      assert.equal(actual?.pattern ?? null, expected, pathname)
      assert.deepEqual(actual, oracle, pathname)
    }
  })

  test('preserves root and segment cardinality', ({ assert }) => {
    const cases = [
      { patterns: ['/'], pathname: '/', expected: '/' },
      { patterns: ['/:title'], pathname: '/', expected: null },
      { patterns: ['/:title'], pathname: '/narnia', expected: '/:title' },
      { patterns: ['/:title?'], pathname: '/', expected: '/:title?' },
      { patterns: ['*'], pathname: '/', expected: '*' },
      { patterns: ['/x', '*'], pathname: '/', expected: '*' },
      { patterns: ['*', '/x'], pathname: '/', expected: '*' },
      { patterns: ['/books/:title'], pathname: '/books', expected: null },
      { patterns: ['/books'], pathname: '/books/123', expected: null },
    ]

    for (const { patterns, pathname, expected } of cases) {
      const definitions = patterns.map((pattern) => ({ pattern }))
      const oracle = matchWithOracle(pathname, definitions)
      const actual = matchWithRouteTable(pathname, definitions)
      assert.equal(actual?.pattern ?? null, expected, JSON.stringify({ patterns, pathname }))
      assert.deepEqual(actual, oracle, JSON.stringify({ patterns, pathname }))
    }
  })

  test('extracts upstream parameter vectors', ({ assert }) => {
    const cases = [
      { pattern: '/', pathname: '/', expected: {} },
      { pattern: '/:type?', pathname: '/', expected: {} },
      { pattern: '/:type?', pathname: '/news', expected: { type: 'news' } },
      { pattern: '/about', pathname: '/about', expected: {} },
      { pattern: 'contact', pathname: '/contact', expected: {} },
      { pattern: '/books/:title', pathname: '/books/foo', expected: { title: 'foo' } },
      {
        pattern: '/videos/:title.mp4',
        pathname: '/videos/foo.mp4',
        expected: { title: 'foo' },
      },
      {
        pattern: '/foo/:bar/:baz',
        pathname: '/foo/hello/world',
        expected: { bar: 'hello', baz: 'world' },
      },
      {
        pattern: 'bar/:baz/:bat?',
        pathname: '/bar/hello',
        expected: { baz: 'hello' },
      },
      {
        pattern: '/books/:title',
        pathname: '/books/foo?author=lukeed',
        expected: { title: 'foo?author=lukeed' },
      },
    ]

    for (const { pattern, pathname, expected } of cases) {
      const oracleTokens = matchit.parse(pattern)
      const actual = extractRouteParams(parseRoute(pattern), pathname)
      assert.deepEqual(actual, expected, JSON.stringify({ pattern, pathname }))
      assert.deepEqual(actual, matchit.exec(pathname, oracleTokens), pattern)
    }
  })

  test('preserves matcher, wildcard, cast, and decoding extensions', ({ assert }) => {
    const definitions: RouteDefinition[] = [
      { pattern: '/foo/:word', matchers: { word: { match: /^[a-z]+$/ } } },
      { pattern: '/foo/:id', matchers: { id: { match: /^\d+$/, cast: Number } } },
      { pattern: '/foo/*' },
    ]

    for (const pathname of ['/foo/hello', '/foo/42', '/foo/a/b', '/foo/fran%C3%A7ais']) {
      assert.deepEqual(
        matchWithRouteTable(pathname, definitions, true),
        matchWithOracle(pathname, definitions, true),
        pathname
      )
    }
  })

  test('matches generated registration orders like the compatibility oracle', ({ assert }) => {
    const routeDefinitions: RouteDefinition[] = [
      { pattern: '/' },
      { pattern: '' },
      { pattern: '//' },
      { pattern: '///' },
      { pattern: '////' },
      { pattern: '/users' },
      { pattern: 'users/' },
      { pattern: '/users//' },
      { pattern: '/users///' },
      { pattern: '//users' },
      { pattern: '/teams//users' },
      { pattern: '/:value' },
      { pattern: '/:value?' },
      { pattern: '/*' },
      { pattern: '/teams/:id', matchers: { id: { match: /^\d+$/, cast: Number } } },
      { pattern: '/teams/:id?' },
      { pattern: '/teams/*' },
      { pattern: '/posts/:slug?.json' },
    ]
    const pathnames = [
      '',
      '/',
      '//',
      '///',
      '////',
      'users',
      '/users',
      '/users/',
      '/users//',
      '//users',
      '/teams/users',
      '/teams//users',
      '/teams',
      '/teams/42',
      '/teams/Romain%20Lanz',
      '/teams/42/members',
      '/posts',
      '/posts/article.json',
      '/missing',
    ]

    let seed = 42
    const random = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0
      return seed / 2 ** 32
    }

    for (let iteration = 0; iteration < 1_000; iteration++) {
      const shuffled = routeDefinitions.slice()
      for (let index = shuffled.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(random() * (index + 1))
        ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
      }

      const definitions = shuffled.slice(0, 1 + Math.floor(random() * 12))
      for (const [pathnameIndex, pathname] of pathnames.entries()) {
        const shouldDecodeParams = pathnameIndex % 2 === 0
        assert.deepEqual(
          matchWithRouteTable(pathname, definitions, shouldDecodeParams),
          matchWithOracle(pathname, definitions, shouldDecodeParams),
          JSON.stringify({
            definitions: definitions.map(({ pattern }) => pattern),
            pathname,
          })
        )
      }
    }
  })
})
