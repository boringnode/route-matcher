import { test } from '@japa/runner'

import { matchRouteTokens, parseRoute, RouteTable } from '../index.ts'

test.group('Route table', () => {
  test('returns the first registered matching route regardless of shape', ({ assert }) => {
    const table = new RouteTable<{ pattern: string }>()
    const dynamicRoute = { pattern: '/:value' }
    const staticRoute = { pattern: '/users' }

    table.add(parseRoute(dynamicRoute.pattern), dynamicRoute)
    table.add(parseRoute(staticRoute.pattern), staticRoute)

    const match = table.match('/users')
    assert.strictEqual(match?.value, dynamicRoute)
    assert.deepEqual(match, { value: dynamicRoute, params: { value: 'users' } })
  })

  test('returns a later static route when an earlier route does not match', ({ assert }) => {
    const table = new RouteTable<string>()
    table.add(parseRoute('/users/:id'), 'dynamic')
    table.add(parseRoute('/users'), 'static')

    assert.deepEqual(table.match('/users'), { value: 'static', params: {} })
  })

  test('matches and decodes wildcard parameters', ({ assert }) => {
    const table = new RouteTable<string>()
    table.add(parseRoute('/files/*'), 'files')

    assert.deepEqual(table.match('/files/folder%20one/file%20two', true), {
      value: 'files',
      params: { '*': ['folder one', 'file two'] },
    })
  })

  test('matches optional parameters with and without a value', ({ assert }) => {
    const table = new RouteTable<string>()
    table.add(parseRoute('/archive/:year?'), 'archive')

    assert.deepEqual(table.match('/archive'), { value: 'archive', params: {} })
    assert.deepEqual(table.match('/archive/2026'), {
      value: 'archive',
      params: { year: '2026' },
    })

    const rootTable = new RouteTable<string>()
    rootTable.add(parseRoute('/:value?'), 'root')
    assert.deepEqual(rootTable.match('/'), { value: 'root', params: {} })
  })

  test('preserves stateful matcher evaluation order', ({ assert }) => {
    const table = new RouteTable<string>()
    const matcher = /^[a-z]+$/g

    table.add(parseRoute('/:value/foo', { value: { match: matcher } }), 'dynamic')
    table.add(parseRoute('/users/bar'), 'static')

    assert.deepEqual(table.match('/users/bar'), { value: 'static', params: {} })
    assert.isNull(table.match('/abc/foo'))
  })

  test('preserves custom regular expression evaluation order', ({ assert }) => {
    const table = new RouteTable<string>()
    const matcher = /^[a-z]+$/
    let matcherCalls = 0
    matcher.exec = function exec(value: string) {
      matcherCalls++
      return RegExp.prototype.exec.call(this, value)
    }

    table.add(parseRoute('/:value/foo', { value: { match: matcher } }), 'dynamic')
    table.add(parseRoute('/users/bar'), 'static')

    assert.deepEqual(table.match('/users/bar'), { value: 'static', params: {} })
    assert.equal(matcherCalls, 1)
  })

  test('evaluates every matcher on a structurally matched route', ({ assert }) => {
    const table = new RouteTable<string>()
    table.add(
      parseRoute('/:section/:id?', {
        section: { match: /^users$/ },
        id: { match: /^\d+$/ },
      }),
      'constrained'
    )
    table.add(parseRoute('/:type/:value'), 'fallback')

    assert.deepEqual(table.match('/users/42'), {
      value: 'constrained',
      params: { section: 'users', id: '42' },
    })
    assert.deepEqual(table.match('/users'), {
      value: 'constrained',
      params: { section: 'users' },
    })
    assert.deepEqual(table.match('/users/not-a-number'), {
      value: 'fallback',
      params: { type: 'users', value: 'not-a-number' },
    })
  })

  test('preserves missing parameter semantics before a trailing optional', ({ assert }) => {
    const table = new RouteTable<string>()
    table.add(parseRoute('/archive/:year/:month?'), 'archive')

    assert.deepEqual(table.match('/archive'), { value: 'archive', params: {} })
  })

  test('does not omit an optional parameter suffix', ({ assert }) => {
    const table = new RouteTable<string>()
    table.add(parseRoute('/posts/:slug?.json'), 'post')

    assert.isNull(table.match('/posts'))
    assert.deepEqual(table.match('/posts/article.json'), {
      value: 'post',
      params: { 'slug?': 'article' },
    })
  })

  test('does not let repeated separators shadow the root route', ({ assert }) => {
    const table = new RouteTable<string>()
    table.add(parseRoute('////'), 'repeated')
    table.add(parseRoute('/'), 'root')

    assert.deepEqual(table.match('/'), { value: 'root', params: {} })
  })

  test('normalizes an empty pattern without matching an empty pathname', ({ assert }) => {
    const table = new RouteTable<string>()
    table.add(parseRoute(''), 'root')

    assert.deepEqual(table.match('/'), { value: 'root', params: {} })
    assert.isNull(table.match(''))
  })

  test('preserves non-canonical wildcard extraction', ({ assert }) => {
    const table = new RouteTable<string>()
    table.add(parseRoute('/*/:id/*'), 'wildcard')

    assert.deepEqual(table.match('////a////'), {
      value: 'wildcard',
      params: {
        '*/:id/*': '',
        'id': '',
        '*': ['a', '', '', ''],
      },
    })
  })

  test('matches a flat transient route list in registration order', ({ assert }) => {
    const routes = [parseRoute('/:value'), parseRoute('/users')]

    assert.deepEqual(matchRouteTokens('/users', routes), { value: 'users' })
    assert.isNull(matchRouteTokens('/users/profile', routes))
  })

  test('keeps invalid encoded values when decoding', ({ assert }) => {
    const table = new RouteTable<string>()
    table.add(parseRoute('/files/:name'), 'file')

    assert.deepEqual(table.match('/files/%E0%A4%A', true), {
      value: 'file',
      params: { name: '%E0%A4%A' },
    })
  })

  test('casts decoded parameter values', ({ assert }) => {
    const table = new RouteTable<string>()
    table.add(
      parseRoute('/users/:id/:name', {
        id: { match: /^\d+$/, cast: Number },
        name: { cast: (value) => value.toUpperCase() },
      }),
      'user'
    )

    assert.deepEqual(table.match('/users/42/romain%20lanz', true), {
      value: 'user',
      params: { id: 42, name: 'ROMAIN LANZ' },
    })
  })

  test('preserves generic payload types', ({ expectTypeOf }) => {
    const table = new RouteTable<{ name: string }>()
    table.add(parseRoute('/'), { name: 'home' })

    expectTypeOf(table.match('/')?.value.name).toEqualTypeOf<string | undefined>()
  })
})

test.group('Route table | specificity precedence', () => {
  test('prefers static, required, optional, then wildcard segments', ({ assert }) => {
    const table = new RouteTable<string>({ precedence: 'specificity' })
    table.add(parseRoute('/chat/*'), 'wildcard')
    table.add(parseRoute('/chat/:room?'), 'optional')
    table.add(parseRoute('/chat/:room'), 'required')
    table.add(parseRoute('/chat/general'), 'static')

    assert.deepEqual(table.match('/chat/general'), { value: 'static', params: {} })
    assert.deepEqual(table.match('/chat/random'), {
      value: 'required',
      params: { room: 'random' },
    })
    assert.deepEqual(table.match('/chat'), { value: 'optional', params: {} })
    assert.deepEqual(table.match('/chat/random/messages'), {
      value: 'wildcard',
      params: { '*': ['random', 'messages'] },
    })
  })

  test('compares specificity from left to right', ({ assert }) => {
    const table = new RouteTable<string>({ precedence: 'specificity' })
    table.add(parseRoute('/:section/settings'), 'static-second')
    table.add(parseRoute('/users/:page'), 'static-first')

    assert.deepEqual(table.match('/users/settings'), {
      value: 'static-first',
      params: { page: 'settings' },
    })
  })

  test('prefers a longer pattern when common segments have equal specificity', ({ assert }) => {
    const table = new RouteTable<string>({ precedence: 'specificity' })
    table.add(parseRoute('/chat'), 'short')
    table.add(parseRoute('/chat/:room?'), 'long')

    assert.deepEqual(table.match('/chat'), { value: 'long', params: {} })
  })

  test('uses registration order for equal specificity', ({ assert }) => {
    const table = new RouteTable<string>({ precedence: 'specificity' })
    table.add(parseRoute('/:first'), 'first')
    table.add(parseRoute('/:second'), 'second')

    assert.deepEqual(table.match('/value'), {
      value: 'first',
      params: { first: 'value' },
    })
  })

  test('falls back when a more specific matcher rejects the segment', ({ assert }) => {
    const table = new RouteTable<string>({ precedence: 'specificity' })
    table.add(parseRoute('/users/*'), 'wildcard')
    table.add(parseRoute('/users/:id', { id: { match: /^\d+$/ } }), 'user')

    assert.deepEqual(table.match('/users/42'), {
      value: 'user',
      params: { id: '42' },
    })
    assert.deepEqual(table.match('/users/not-a-number'), {
      value: 'wildcard',
      params: { '*': ['not-a-number'] },
    })
  })

  test('preserves registration order within unindexed equal-specificity routes', ({ assert }) => {
    const table = new RouteTable<string>({ precedence: 'specificity' })
    table.add(parseRoute('/:first', { first: { match: /^value$/g } }), 'first')
    table.add(parseRoute('/:second', { second: { match: /^value$/g } }), 'second')

    assert.deepEqual(table.match('/value'), {
      value: 'first',
      params: { first: 'value' },
    })
  })

  test('matches generated route orders like a flat specificity sort', ({ assert }) => {
    const definitions = [
      { pattern: '/' },
      { pattern: '' },
      { pattern: '////' },
      { pattern: '/users' },
      { pattern: '/:value' },
      { pattern: '/:value?' },
      { pattern: '/*' },
      { pattern: '/teams/:id', matchers: { id: { match: /^\d+$/, cast: Number } } },
      { pattern: '/teams/:id?' },
      { pattern: '/teams/*' },
      { pattern: '/teams/:id/members' },
      { pattern: '/teams/static/:member?' },
      { pattern: '/:section/settings' },
      { pattern: '/users/:page' },
      { pattern: '/posts/:slug?.json' },
    ]
    const pathnames = [
      '',
      '/',
      '////',
      '/users',
      '/users/settings',
      '/teams',
      '/teams/42',
      '/teams/abc',
      '/teams/42/members',
      '/teams/static',
      '/teams/static/member',
      '/teams/42/extra',
      '/posts',
      '/posts/article.json',
      '/missing',
    ]
    const scores = [3, 2, 0, 1]
    let seed = 91
    const random = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0
      return seed / 2 ** 32
    }

    for (let iteration = 0; iteration < 500; iteration++) {
      const shuffled = definitions.slice()
      for (let index = shuffled.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(random() * (index + 1))
        ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
      }

      const registered = shuffled
        .slice(0, 1 + Math.floor(random() * shuffled.length))
        .map((definition, order) => ({
          order,
          pattern: definition.pattern,
          tokens: parseRoute(definition.pattern, definition.matchers),
        }))
      const sorted = registered.slice().sort((a, b) => {
        const length = Math.max(a.tokens.length, b.tokens.length)
        for (let index = 0; index < length; index++) {
          const aScore = a.tokens[index] ? scores[a.tokens[index].type] : -1
          const bScore = b.tokens[index] ? scores[b.tokens[index].type] : -1
          if (aScore !== bScore) return bScore - aScore
        }
        return a.order - b.order
      })
      const table = new RouteTable<string>({ precedence: 'specificity' })
      for (const route of registered) table.add(route.tokens, route.pattern)

      for (const pathname of pathnames) {
        let expected = null
        for (const route of sorted) {
          const params = matchRouteTokens(pathname, [route.tokens], true)
          if (params !== null) {
            expected = { value: route.pattern, params }
            break
          }
        }
        assert.deepEqual(table.match(pathname, true), expected, pathname)
      }
    }
  })
})
