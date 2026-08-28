# @boringnode/route-matcher

A small, zero-dependency route parser and indexed route table for Node.js.

```sh
yarn add @boringnode/route-matcher
```

## Parse a route

```ts
import { parseRoute } from '@boringnode/route-matcher'

const tokens = parseRoute('/users/:id.json', {
  id: { match: /^\d+$/, cast: Number },
})
```

Patterns support static segments, required parameters (`:id`), optional parameters (`:id?`),
parameter suffixes (`:id.json`), and trailing wildcards (`*`). A matcher may constrain a parameter
with `match` and transform its extracted value with `cast`.

## Match routes

```ts
import { parseRoute, RouteTable } from '@boringnode/route-matcher'

type Route = { name: string }

const routes = new RouteTable<Route>()

routes.add(parseRoute('/:slug'), { name: 'page' })
routes.add(parseRoute('/about'), { name: 'about' })

routes.match('/about')
// { value: { name: 'page' }, params: { slug: 'about' } }
```

By default, the first registered matching route wins. Route shape does not change precedence: an
earlier parameter or wildcard route can win over a later static route. The table uses static lookup
and a private segment index to discard impossible candidates while preserving registration order.

### Specificity precedence

Applications that need the most specific match can opt in when creating the table:

```ts
const routes = new RouteTable<Route>({ precedence: 'specificity' })
```

Specificity is compared segment by segment from left to right. Static segments rank above required
parameters, followed by optional parameters and wildcards. When common segments have equal
specificity, the longer pattern wins. Equally specific patterns retain registration order.

`match(pathname, true)` decodes parameters with `decodeURIComponent`. Decoding is off by default.
Invalid percent-encoded values are kept unchanged, and `cast` functions run after decoding.
Wildcards are returned under `'*'` as an array of path segments. This package matches path strings
as provided; it does not remove query strings.

For a short-lived list that does not need an index, use `matchRouteTokens`:

```ts
import { matchRouteTokens, parseRoute } from '@boringnode/route-matcher'

const params = matchRouteTokens('/posts/42', [parseRoute('/posts/:id')])
// { id: '42' }
```

`extractRouteParams` is also exported for consumers that keep their own route index.

## License

[MIT](./LICENSE.md)
