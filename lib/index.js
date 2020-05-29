var assert = require('assert');
var dict = require('./dict');
var Parser = require('./parser');
var Handlers = require('./handlers');

var JSONPath = function() {
  this.initialize.apply(this, arguments);
};

JSONPath.prototype.initialize = function() {
  this.parser = new Parser();
  this.handlers = new Handlers();
};

JSONPath.prototype.shutdown = function(){
  return this.handlers.shutdown()
}

JSONPath.prototype.parse = async function(string) {
  assert.ok(_is_string(string), "we need a path");
  return this.parser.parse(string);
};

JSONPath.prototype.parent = async function(obj, string) {
  assert.ok(obj instanceof Object, "obj needs to be an object");
  assert.ok(string, "we need a path");

  var node = (await this.nodes(obj, string))[0];
  var key = node.path.pop(); /* jshint unused:false */
  return await this.value(obj, node.path);
}

JSONPath.prototype.apply = async function(obj, string, fn) {
  assert.ok(obj instanceof Object, "obj needs to be an object");
  assert.ok(string, "we need a path");
  assert.equal(typeof fn, "function", "fn needs to be function")

  var nodes = (await this.nodes(obj, string)).sort(function(a, b) {
    // sort nodes so we apply from the bottom up
    return b.path.length - a.path.length;
  });

  for(var n = 0; n < nodes.length; n += 1){
    var node = nodes[n];
    var key = node.path.pop();
    var parent = await this.value(obj, await this.stringify(node.path));
    var val = node.value = fn.call(obj, parent[key]);
    parent[key] = val;
  }

  return nodes;
}

JSONPath.prototype.value = async function(obj, path, value) {
  assert.ok(obj instanceof Object, "obj needs to be an object");
  assert.ok(path, "we need a path");

  if (arguments.length >= 3) {
    var node = (await this.nodes(obj, path)).shift();
    if (!node) return await this._vivify(obj, path, value);

    var key = node.path.slice(-1).shift();
    var parent = await this.parent(obj, await this.stringify(node.path));
    parent[key] = value;
  }
  return (await this.query(obj, await this.stringify(path), 1)).shift();
}

JSONPath.prototype._vivify = async function(obj, string, value) {
  var self = this;

  assert.ok(obj instanceof Object, "obj needs to be an object");
  assert.ok(string, "we need a path");

  var path = this.parser.parse(string)
    .map(function(component) { return component.expression.value });

  var setValue = async function(path, value) {
    var key = path.pop();
    var node = await self.value(obj, path);
    if (!node) {
      await setValue(path.concat(), typeof key === 'string' ? {} : []);
      node = await self.value(obj, path);
    }
    node[key] = value;
  }
  await setValue(path, value);
  return (await this.query(obj, string))[0];
}

JSONPath.prototype.query = async function(obj, string, count) {
  assert.ok(obj instanceof Object, "obj needs to be an object");
  assert.ok(_is_string(string), "we need a path");

  var nodes = await this.nodes(obj, string, count)
  return nodes.map(function(r) { return r.value });
};

JSONPath.prototype.paths = async function(obj, string, count) {
  assert.ok(obj instanceof Object, "obj needs to be an object");
  assert.ok(string, "we need a path");

  var nodes = await this.nodes(obj, string, count)
  return nodes.map(function(r) { return r.path });
};

JSONPath.prototype.nodes = async function(obj, string, count) {
  assert.ok(obj instanceof Object, "obj needs to be an object");
  assert.ok(string, "we need a path");

  if (count === 0) return [];

  var path = this.parser.parse(string);
  var handlers = this.handlers;

  var partials = [ { path: ['$'], value: obj } ];
  var matches = [];

  if (path.length && path[0].expression.type == 'root') path.shift();

  if (!path.length) return partials;

  for(var index = 0; index < path.length; index += 1){
    const component = path[index];

    if (matches.length >= count) break;
    var handler = handlers.resolve(component);
    var _partials = [];

    for(var pi = 0; pi < partials.length; pi += 1){
      var p = partials[pi]

      if (matches.length >= count) break;
      var results = await handler(component, p, count);

      if (index == path.length - 1) {
        // if we're through the components we're done
        matches = matches.concat(results || []);
      } else {
        // otherwise accumulate and carry on through
        _partials = _partials.concat(results || []);
      }
    }

    partials = _partials;
  }

  return count ? matches.slice(0, count) : matches;
};

JSONPath.prototype.stringify = async function(path) {
  assert.ok(path, "we need a path");

  var string = '$';

  var templates = {
    'descendant-member': '..{{value}}',
    'child-member': '.{{value}}',
    'descendant-subscript': '..[{{value}}]',
    'child-subscript': '[{{value}}]'
  };

  path = this._normalize(path);

  for(var p = 0; p < path.length; p += 1){
    const component = path[p]

    if (component.expression.type == 'root') continue;

    var key = [component.scope, component.operation].join('-');
    var template = templates[key];
    var value;

    if (component.expression.type == 'string_literal') {
      value = JSON.stringify(component.expression.value)
    } else {
      value = component.expression.value;
    }

    if (!template) throw new Error("couldn't find template " + key);

    string += template.replace(/{{value}}/, value);
  }

  return string;
}

JSONPath.prototype._normalize = function(path) {
  assert.ok(path, "we need a path");

  if (typeof path == "string") {

    return this.parser.parse(path);

  } else if (Array.isArray(path) && typeof path[0] == "string") {

    var _path = [ { expression: { type: "root", value: "$" } } ];

    for(var index = 0; index < path.length; index += 1){
      const component = path[index]

      if (component == '$' && index === 0) continue;

      if (typeof component == "string" && component.match("^" + dict.identifier + "$")) {

        _path.push({
          operation: 'member',
          scope: 'child',
          expression: {
            value: component,
            type: 'identifier'
          }
        });

      } else {

        var type = typeof component == "number" ?
          'numeric_literal' : 'string_literal';

        _path.push({
          operation: 'subscript',
          scope: 'child',
          expression: {
            value: component,
            type: type
          }
        });
      }
    };

    return _path;

  } else if (Array.isArray(path) && typeof path[0] == "object") {

    return path
  }

  throw new Error("couldn't understand path " + path);
}

function _is_string(obj) {
  return Object.prototype.toString.call(obj) == '[object String]';
}

JSONPath.Handlers = Handlers;
JSONPath.Parser = Parser;

var instance = new JSONPath;
instance.JSONPath = JSONPath;

module.exports = instance;
