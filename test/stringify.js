var assert = require('assert');
var jp = require('../');

suite('stringify', function() {

  test('simple path stringifies', async function() {
    var string = await jp.stringify(['$', 'a', 'b', 'c']);
    assert.equal(string, '$.a.b.c');
  });

  test('numeric literals end up as subscript numbers', async function() {
    var string = await jp.stringify(['$', 'store', 'book', 0, 'author']);
    assert.equal(string, '$.store.book[0].author');
  });

  test('simple path with no leading root stringifies', async function() {
    var string = await jp.stringify(['a', 'b', 'c']);
    assert.equal(string, '$.a.b.c');
  });

  test('simple parsed path stringifies', async function() {
    var path = [
      { scope: 'child', operation: 'member', expression: { type: 'identifier', value: 'a' } },
      { scope: 'child', operation: 'member', expression: { type: 'identifier', value: 'b' } },
      { scope: 'child', operation: 'member', expression: { type: 'identifier', value: 'c' } }
    ];
    var string = await jp.stringify(path);
    assert.equal(string, '$.a.b.c');
  });

  test('keys with hyphens get subscripted', async function() {
    var string = await jp.stringify(['$', 'member-search']);
    assert.equal(string, '$["member-search"]');
  });

  test('complicated path round trips', async function() {
    var pathExpression = '$..*[0:2].member["string-xyz"]';
    var path = await jp.parse(pathExpression);
    var string = await jp.stringify(path);
    assert.equal(string, pathExpression);
  });

  test('complicated path with filter exp round trips', async function() {
    var pathExpression = '$..*[0:2].member[?(@.val > 10)]';
    var path = await jp.parse(pathExpression);
    var string = await jp.stringify(path);
    assert.equal(string, pathExpression);
  });

  test('throws for no input', async function() {
    await assert.rejects(async function() { await jp.stringify() }, /we need a path/);
  });

});
