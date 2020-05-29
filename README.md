# jsonpath-sandbox

Query JavaScript objects with JSONPath expressions.  Robust / safe JSONPath engine for Node.js.

This is a fork of the [dchester/jsonpath](https://github.com/dchester/jsonpath) library for nodejs. 
See **Differences from dchester implementation** below for specific differences. Most notably this version uses the [v8-sandbox](https://github.com/fulcrumapp/v8-sandbox) library to evaluate filter expressions in a safe manner (vs [static-eval](https://github.com/browserify/static-eval) which is not suitable for running abritrary / untrusted user input) and thus presents an asynchronous / **Promise**-based API.


## Query Example

```javascript
var cities = [
  { name: "London", "population": 8615246 },
  { name: "Berlin", "population": 3517424 },
  { name: "Madrid", "population": 3165235 },
  { name: "Rome",   "population": 2870528 }
];

var jp = require('jsonpath-sandbox');
jp.query(cities, '$..name')
  .then(function(names){
    console.log(names)
    // => [ "London", "Berlin", "Madrid", "Rome" ]

    jp.shutdown()
  }) 
```

### Important! Shutdown must be invoked

To cleanly terminate the v8 javascript interpreter, the **shutdown** method must be invoked after operations are completed. Otherwise your nodejs process will not terminate!

## Install

Install from npm:
```bash
$ npm install jsonpath-sandbox
```

## JSONPath Syntax

Here are syntax and examples adapted from [Stefan Goessner's original post](http://goessner.net/articles/JsonPath/) introducing JSONPath in 2007.

JSONPath         | Description
-----------------|------------
`$`               | The root object/element
`@`                | The current object/element
`.`                | Child member operator
`..`	         | Recursive descendant operator; JSONPath borrows this syntax from E4X
`*`	         | Wildcard matching all objects/elements regardless their names
`[]`	         | Subscript operator
`[,]`	         | Union operator for alternate names or array indices as a set
`[start:end:step]` | Array slice operator borrowed from ES4 / Python
`?()`              | Applies a filter (script) expression via static evaluation
`()`	         | Script expression via static evaluation 

Given this sample data set, see example expressions below:

```javascript
{
  "store": {
    "book": [ 
      {
        "category": "reference",
        "author": "Nigel Rees",
        "title": "Sayings of the Century",
        "price": 8.95
      }, {
        "category": "fiction",
        "author": "Evelyn Waugh",
        "title": "Sword of Honour",
        "price": 12.99
      }, {
        "category": "fiction",
        "author": "Herman Melville",
        "title": "Moby Dick",
        "isbn": "0-553-21311-3",
        "price": 8.99
      }, {
         "category": "fiction",
        "author": "J. R. R. Tolkien",
        "title": "The Lord of the Rings",
        "isbn": "0-395-19395-8",
        "price": 22.99
      }
    ],
    "bicycle": {
      "color": "red",
      "price": 19.95
    }
  }
}
```

Example JSONPath expressions:

JSONPath                      | Description
------------------------------|------------
`$.store.book[*].author`       | The authors of all books in the store
`$..author`                     | All authors
`$.store.*`                    | All things in store, which are some books and a red bicycle
`$.store..price`                | The price of everything in the store
`$..book[2]`                    | The third book
`$..book[(@.length-1)]`         | The last book via script subscript
`$..book[-1:]`                  | The last book via slice
`$..book[0,1]`                  | The first two books via subscript union
`$..book[:2]`                  | The first two books via subscript array slice
`$..book[?(@.isbn)]`            | Filter all books with isbn number
`$..book[?(@.price<10)]`        | Filter all books cheaper than 10
`$..book[?(@.price==8.95)]`        | Filter all books that cost 8.95
`$..book[?(@.price<30 && @.category=="fiction")]`        | Filter all fiction books cheaper than 30
`$..*`                         | All members of JSON structure


## Methods

All methods below are defined asynchronously and return Promises. Handle with **then** / **catch** blocks or invoke with **await**.

#### jp.query(obj, pathExpression[, count])

Find elements in `obj` matching `pathExpression`.  Yields an array of elements that satisfy the provided JSONPath expression, or an empty array if none were matched.  Array contains only first `count` elements if specified.

```javascript
jp.query(data, '$..author')
  .then(function(authors){
    // => [ 'Nigel Rees', 'Evelyn Waugh', 'Herman Melville', 'J. R. R. Tolkien' ]
  })
```

#### jp.paths(obj, pathExpression[, count])

Find paths to elements in `obj` matching `pathExpression`.  Yields an array of element paths that satisfy the provided JSONPath expression. Each path is itself an array of keys representing the location within `obj` of the matching element.  Returns only first `count` paths if specified.


```javascript
jp.paths(data, '$..author')
  .then(function(paths){
    // => [
    //      ['$', 'store', 'book', 0, 'author'],
    //      ['$', 'store', 'book', 1, 'author'],
    //      ['$', 'store', 'book', 2, 'author'],
    //      ['$', 'store', 'book', 3, 'author']
    //    ]
  })
```

#### jp.nodes(obj, pathExpression[, count])

Find elements and their corresponding paths in `obj` matching `pathExpression`.  Yields an array of node objects where each node has a `path` containing an array of keys representing the location within `obj`, and a `value` pointing to the matched element.  Array contains only first `count` nodes if specified.

```javascript
jp.nodes(data, '$..author')
  .then(function(nodes){
    // => [
    //      { path: ['$', 'store', 'book', 0, 'author'], value: 'Nigel Rees' },
    //      { path: ['$', 'store', 'book', 1, 'author'], value: 'Evelyn Waugh' },
    //      { path: ['$', 'store', 'book', 2, 'author'], value: 'Herman Melville' },
    //      { path: ['$', 'store', 'book', 3, 'author'], value: 'J. R. R. Tolkien' }
    //    ]
  })
```

#### jp.value(obj, pathExpression[, newValue])

Yields the value of the first element matching `pathExpression`.  If `newValue` is provided, sets the value of the first matching element and returns the new value.

#### jp.parent(obj, pathExpression)

Yields the parent of the first matching element.

#### jp.apply(obj, pathExpression, fn)

Runs the supplied function `fn` on each matching element, and replaces each matching element with the return value from the function.  The function accepts the value of the matching element as its only parameter.  Yields matching nodes with their updated values.


```javascript
jp.apply(data, '$..author', function(value) { return value.toUpperCase() })
  .then(function(nodes){
    // => [
    //      { path: ['$', 'store', 'book', 0, 'author'], value: 'NIGEL REES' },
    //      { path: ['$', 'store', 'book', 1, 'author'], value: 'EVELYN WAUGH' },
    //      { path: ['$', 'store', 'book', 2, 'author'], value: 'HERMAN MELVILLE' },
    //      { path: ['$', 'store', 'book', 3, 'author'], value: 'J. R. R. TOLKIEN' }
    //    ]
  })
```

#### jp.parse(pathExpression)

Parse the provided JSONPath expression into path components and their associated operations.

```javascript
jp.parse('$..author')
  .then(function(path){
    // => [
    //      { expression: { type: 'root', value: '$' } },
    //      { expression: { type: 'identifier', value: 'author' }, operation: 'member', scope: 'descendant' }
    //    ]
  })
```

#### jp.stringify(path)

Returns a path expression in string form, given a path.  The supplied path may either be a flat array of keys, as returned by `jp.nodes` for example, or may alternatively be a fully parsed path expression in the form of an array of path components as returned by `jp.parse`.

```javascript
jp.stringify(['$', 'store', 'book', 0, 'author'])
  .then(function(pathExpression){
    // =>  "$.store.book[0].author"
  })
```

#### jp.shutdown()

Terminate the v8 execution environment. Must be called before nodejs can exit.

## Differences from dchester Implementation

This implementation aims to be as compatible with dchester's implementation and thus the original Stefan Goessner implemention as possible. See the README in dchester's repo for differences with the original implementation. Differences with dchester's implementation can be found below

#### v8-sandbox engine is used

After an analysis of the dchester/jsonpath project (see **docs/jsonpath-audit**) we determined that a more secure solution was needed to process filter expressions. According to the [README](https://github.com/browserify/static-eval/blob/master/readme.markdown) in the static-eval project:

**It (static-eval) is NOT suitable for handling arbitrary untrusted user input. Malicious user input can execute arbitrary code.**

Security issues are mitigated by utilizing Google's V8 javascript interpreter as presented via the v8-sandbox library. According to the v8-sandbox [README](https://github.com/fulcrumapp/v8-sandbox/blob/master/README.md):

**Safely execute arbitrary untrusted JavaScript from nodejs. This module implements an isolated JavaScript environment that can be used to run any code without being able to escape the sandbox. **

#### Asynchronous API

Because v8-sandbox implements an asynchronous (Promise-based) execution environment this library had to be refactored correspondingly. Thus all public API calls return promises which you can handle via **then** and **catch** resolution / rejection callbacks or using the **await** keyword in async functions.

#### Not accessible from browser

Because v8-sandbox leverages C++ logic to interface with the V8 Javascript runtime, this library is currently not exportable to the web-browser. We may look into the feasability of this in the future (Pull-Requests are more than welcome!)

#### _AT_SYMBOL_

Because there is currently no simple way to monkey-patch V8 in a similar manner to dchester's monkey-patching of [esprima](https://esprima.org/) (so as to permit **@** to be used as an identifier for seamless filter expression execution), we swap **@** with a static string before execution. The string **_AT_SYMBOL_** is used in this case. Unfortunately if this library is used to process a filter expression with the "_AT_SYMBOL_" string in it, it will not work properly. This is a quick fix until we can figure out a better solution.

## License

[MIT](LICENSE)

