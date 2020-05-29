var assert = require('assert');
var jp = require('../');

var data = require('./data/store.json');

suite('orig-google-code-issues', function() {

  test('comma in eval', async function() {
    var pathExpression = '$..book[?(@.price && ",")]'
    var results = await jp.query(data, pathExpression);
    assert.deepEqual(results, data.store.book);
  });

  test('member names with dots', async function() {
    var data = { 'www.google.com': 42, 'www.wikipedia.org': 190 };
    var results = await jp.query(data, "$['www.google.com']");
    assert.deepEqual(results, [ 42 ]);
  });

  test('nested objects with filter', async function() {
    var data = { dataResult: { object: { objectInfo: { className: "folder", typeName: "Standard Folder", id: "uniqueId" } } } };
    var results = await jp.query(data, "$..object[?(@.className=='folder')]");
    assert.deepEqual(results, [ data.dataResult.object.objectInfo ]);
  });

  test('script expressions with @ char', async function() {
    var data = { "DIV": [{ "@class": "value", "val": 5 }] };
    var results = await jp.query(data, "$..DIV[?(@['@class']=='value')]");
    assert.deepEqual(results, data.DIV);
  });

  test('negative slices', async function() {
    var results = await jp.query(data, "$..book[-1:].title");
    assert.deepEqual(results, ['The Lord of the Rings']);
  });

});
