export type RouteTokenType = 0 | 1 | 2 | 3

export type RouteMatcher = {
  match?: RegExp
  cast?: (value: string) => any
}

export type RouteMatchers = Record<string, RouteMatcher>

export type RouteToken = {
  old: string
  type: RouteTokenType
  val: string
  end: string
  matcher?: RegExp
  cast?: (value: string) => any
}

export type RouteParams = Record<string, any>

export type RouteMatch<T> = {
  params: RouteParams
  value: T
}

export type RoutePrecedence = 'registration' | 'specificity'

export type RouteTableOptions = {
  precedence?: RoutePrecedence
}
