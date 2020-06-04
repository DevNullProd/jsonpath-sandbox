var assert = require('assert');
var jp = require('../');

suite('complexity', function() {

  test('simple expression with no filter or script expressions', function() {
    const expected = {
       components : 2,
      expressions : 0,
            unary : 0,
           binary : 0,
          logical : 0
    }

    assert.deepEqual(jp.complexity("$.a"), expected)
  });

  test('expression with filter and script expressions', function() {
    const expected = {
       components : 4,
      expressions : 2,
            unary : 0,
           binary : 0,
          logical : 0
    }

    assert.deepEqual(jp.complexity("$.a[(@.b)][?(@.c)]"), expected)
  })

  test('filter and script expressions with unary, binary, and logical expressions', function() {
    const expected = {
       components : 4,
      expressions : 2,
            unary : 1,
           binary : 2,
          logical : 3
    }

    assert.deepEqual(jp.complexity("$.a[(@.b + 1 == 5)][?(@.c && @d || !@.e || @.f)]"), expected)
  })

});
