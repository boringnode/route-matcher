# @boringnode/route-matcher

<div align="center">

[![typescript-image]][typescript-url]
[![gh-workflow-image]][gh-workflow-url]
[![npm-image]][npm-url]
[![npm-download-image]][npm-download-url]
[![license-image]][license-url]

</div>

A small, zero-dependency route parser and indexed route table for Node.js. It supports static
segments, parameters, wildcards, custom matchers, and typed route values.

## Installation

```bash
npm install @boringnode/route-matcher
```

## Features

- **Route patterns**: Static, required, optional, suffixed, and wildcard segments
- **Indexed matching**: Discards impossible candidates without changing route precedence
- **Configurable precedence**: Match by registration order or route specificity
- **Parameter constraints**: Validate parameters with regular expressions
- **Parameter casting**: Transform matched parameters into numbers or other values
- **Type-safe values**: Associate any typed value with a route
- **Zero dependencies**: No runtime dependencies

## Quick start

```ts
import { parseRoute, RouteTable } from '@boringnode/route-matcher'

type Route = {
  name: string
}

const routes = new RouteTable<Route>()

routes.add(
  parseRoute('/users/:id', {
    id: { match: /^\d+$/, cast: Number },
  }),
  { name: 'users.show' }
)

routes.add(parseRoute('/about'), { name: 'about' })

routes.match('/users/42')
// { value: { name: 'users.show' }, params: { id: 42 } }
```

`RouteTable` keeps the generic value type, so `match().value` has the same type as the values passed
to `add()`.

## Route patterns

| Pattern             | Matches                   | Parameters                        |
| ------------------- | ------------------------- | --------------------------------- |
| `/users`            | `/users`                  | `{}`                              |
| `/users/:id`        | `/users/42`               | `{ id: '42' }`                    |
| `/archive/:year?`   | `/archive`, `/archive/26` | `{}` or `{ year: '26' }`          |
| `/files/:name.json` | `/files/report.json`      | `{ name: 'report' }`              |
| `/files/*`          | `/files/images/logo.png`  | `{ '*': ['images', 'logo.png'] }` |

Wildcards must be the last segment of a pattern.

### Matchers and casts

Pass parameter matchers as the second argument to `parseRoute`. A matcher may constrain the value
with `match` and transform it with `cast`.

```ts
const userRoute = parseRoute('/users/:id', {
  id: {
    match: /^\d+$/,
    cast: Number,
  },
})
```

If a matcher rejects a parameter, the table continues with the next matching route.

## Route precedence

By default, the first registered route that matches the pathname wins. Route shape does not change
precedence.

```ts
const routes = new RouteTable<string>()

routes.add(parseRoute('/:slug'), 'page')
routes.add(parseRoute('/about'), 'about')

routes.match('/about')
// { value: 'page', params: { slug: 'about' } }
```

Use specificity precedence when static routes should win over dynamic routes regardless of
registration order.

```ts
const routes = new RouteTable<string>({ precedence: 'specificity' })

routes.add(parseRoute('/:slug'), 'page')
routes.add(parseRoute('/about'), 'about')

routes.match('/about')
// { value: 'about', params: {} }
```

Specificity is compared segment by segment from left to right. Static segments rank above required
parameters, followed by optional parameters and wildcards. Longer patterns win when their shared
segments have equal specificity. Registration order breaks remaining ties.

## Parameter decoding

Parameter decoding is disabled by default. Pass `true` to `match` to decode parameters with
`decodeURIComponent` before applying casts.

```ts
const routes = new RouteTable<string>()
routes.add(parseRoute('/files/:name'), 'file')

routes.match('/files/hello%20world', true)
// { value: 'file', params: { name: 'hello world' } }
```

Invalid percent-encoded values remain unchanged. Wildcard segments are decoded one at a time.

> [!NOTE]
> The package matches the pathname exactly as provided. It does not remove query strings. Pass a
> URL's `pathname` when query parameters should not be part of the match.

## Matching without a route table

Use `matchRouteTokens` for a short-lived route list that does not need an index. Routes are checked
in array order.

```ts
import { matchRouteTokens, parseRoute } from '@boringnode/route-matcher'

const params = matchRouteTokens('/posts/42', [parseRoute('/posts/:id')])
// { id: '42' }
```

The package also exports `extractRouteParams` for consumers that maintain their own route index.

## License

[MIT](./LICENSE.md)

[gh-workflow-image]: https://img.shields.io/github/actions/workflow/status/boringnode/route-matcher/checks.yml?branch=main&style=for-the-badge
[gh-workflow-url]: https://github.com/boringnode/route-matcher/actions/workflows/checks.yml
[npm-image]: https://img.shields.io/npm/v/@boringnode/route-matcher.svg?style=for-the-badge&logo=npm
[npm-url]: https://www.npmjs.com/package/@boringnode/route-matcher
[npm-download-image]: https://img.shields.io/npm/dm/@boringnode/route-matcher?style=for-the-badge
[npm-download-url]: https://www.npmjs.com/package/@boringnode/route-matcher
[typescript-image]: https://img.shields.io/badge/Typescript-294E80.svg?style=for-the-badge&logo=typescript
[typescript-url]: https://www.typescriptlang.org
[license-image]: https://img.shields.io/npm/l/@boringnode/route-matcher?color=blueviolet&style=for-the-badge
[license-url]: LICENSE.md
