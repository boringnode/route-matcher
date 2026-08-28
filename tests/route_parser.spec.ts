/*
 * Compatibility tests derived from @adonisjs/http-server and @poppinss/matchit.
 * Both projects are licensed under the MIT License.
 */

// @ts-expect-error @poppinss/matchit does not publish TypeScript declarations
import matchit from '@poppinss/matchit'
import { test } from '@japa/runner'

import { parseRoute } from '../index.ts'

test.group('Route parser', () => {
  test('ignores non-object matcher collections', ({ assert }) => {
    assert.deepEqual(parseRoute('/:0', 'x' as never), matchit.parse('/:0', 'x'))
  })

  test('parses generated patterns like the compatibility oracle', ({ assert }) => {
    const alphabet = ['/', ':', '*', '?', '.', 'a', 'Z', '0', '-', '_', 'é', '😀']
    let seed = 73
    const random = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0
      return seed / 2 ** 32
    }

    for (let iteration = 0; iteration < 10_000; iteration++) {
      const length = Math.floor(random() * 30)
      let pattern = ''
      for (let index = 0; index < length; index++) {
        pattern += alphabet[Math.floor(random() * alphabet.length)]
      }

      assert.deepEqual(parseRoute(pattern), matchit.parse(pattern), pattern)
    }
  })

  test('parses required parameters and suffixes', ({ assert }) => {
    assert.deepEqual(parseRoute('/posts/:id.json'), [
      { end: '', old: '/posts/:id.json', type: 0, val: 'posts' },
      {
        cast: undefined,
        end: '.json',
        matcher: undefined,
        old: '/posts/:id.json',
        type: 1,
        val: 'id',
      },
    ])
  })

  test('preserves optional parameter suffix semantics', ({ assert }) => {
    assert.deepEqual(parseRoute('/posts/:id?.json'), [
      { end: '', old: '/posts/:id?.json', type: 0, val: 'posts' },
      {
        cast: undefined,
        end: '.json',
        matcher: undefined,
        old: '/posts/:id?.json',
        type: 3,
        val: 'id?',
      },
    ])
  })

  test('parses wildcards', ({ assert }) => {
    assert.deepEqual(parseRoute('/posts/*'), [
      { end: '', old: '/posts/*', type: 0, val: 'posts' },
      { end: '', old: '/posts/*', type: 2, val: '*' },
    ])
  })
})
