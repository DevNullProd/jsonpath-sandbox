var assert = require('assert');
var dict = require('./dict');
var Parser = require('./parser');
var Handlers = require('./handlers');
var _memoize = require('./memoize')

var aesprim = require('./aesprim')
var _compact = require('underscore').compact

var JSONPath = function() {
  this.initialize.apply(this, arguments);
};

JSONPath.prototype.initialize = function() {
  this.parser = new Parser();
  this.parser.parse = _memoize(this.parser.parse)
  this.handlers = new Handlers();
};

JSONPath.prototype.cache_timeout = function(cache_timeout){
  if(this.cache_timer){
    clearInterval(this.cache_timer)
    delete this.cache_timer
  }

  if(cache_timeout){
    this.cache_timer = setInterval(function(){
      const now = new Date()
      const memoizers = _compact([
        this.parser.parse,
        this._stringify,
        this._normalize,
        this.handlers._replace_at
      ])

      memoizers.forEach(function(memoizer){
        memoizer.keys().forEach(function(key){
          if(now - memoizer.timestamps[key] > cache_timeout)
            memoizer.remove(key)
        }.bind(this))
      }.bind(this))
    }.bind(this), cache_timeout)
  }
}

JSONPath.prototype.expression_timeout = function(expression_timeout){
  this.handlers.expression_timeout = expression_timeout;
}

JSONPath.prototype.parse = function(string) {
  assert.ok(_is_string(string), "we need a path");
  return this.parser.parse(string);
};

JSONPath.prototype.parent = function(obj, string) {
  assert.ok(obj instanceof Object, "obj needs to be an object");
  assert.ok(string, "we need a path");

  var node = this.nodes(obj, string)[0];
  var key = node.path.pop(); /* jshint unused:false */
  return this.value(obj, node.path);
}

JSONPath.prototype.apply = function(obj, string, fn) {
  assert.ok(obj instanceof Object, "obj needs to be an object");
  assert.ok(string, "we need a path");
  assert.equal(typeof fn, "function", "fn needs to be function")

  var nodes = this.nodes(obj, string).sort(function(a, b) {
    // sort nodes so we apply from the bottom up
    return b.path.length - a.path.length;
  });

  for(var n = 0; n < nodes.length; n += 1){
    var node = nodes[n];
    var key = node.path.pop();
    var parent = this.value(obj, this.stringify(node.path));
    var val = node.value = fn.call(obj, parent[key]);
    parent[key] = val;
  }

  return nodes;
}

JSONPath.prototype.value = function(obj, path, value) {
  assert.ok(obj instanceof Object, "obj needs to be an object");
  assert.ok(path, "we need a path");

  if (arguments.length >= 3) {
    var node = this.nodes(obj, path).shift();
    if (!node) return this._vivify(obj, path, value);

    var key = node.path.slice(-1).shift();
    var parent = this.parent(obj, this.stringify(node.path));
    parent[key] = value;
  }
  return this.query(obj, this.stringify(path), 1).shift();
}

JSONPath.prototype._vivify = function(obj, string, value) {
  var self = this;

  assert.ok(obj instanceof Object, "obj needs to be an object");
  assert.ok(string, "we need a path");

  var path = this.parser.parse(string)
    .map(function(component) { return component.expression.value });

  var setValue = function(path, value) {
    var key = path.pop();
    var node = self.value(obj, path);
    if (!node) {
      setValue(path.concat(), typeof key === 'string' ? {} : []);
      node = self.value(obj, path);
    }
    node[key] = value;
  }
  setValue(path, value);
  return this.query(obj, string)[0];
}

JSONPath.prototype.query = function(obj, string, count) {
  assert.ok(obj instanceof Object, "obj needs to be an object");
  assert.ok(_is_string(string), "we need a path");

  var nodes = this.nodes(obj, string, count)
  return nodes.map(function(r) { return r.value });
};

JSONPath.prototype.paths = function(obj, string, count) {
  assert.ok(obj instanceof Object, "obj needs to be an object");
  assert.ok(string, "we need a path");

  var nodes = this.nodes(obj, string, count)
  return nodes.map(function(r) { return r.path });
};

JSONPath.prototype.nodes = function(obj, string, count) {
  assert.ok(obj instanceof Object, "obj needs to be an object");
  assert.ok(string, "we need a path");

  if (count === 0) return [];

  // slice to copy before manipulating:
  var path = this.parser.parse(string).slice();
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
      var results = handler(component, p, count);

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

JSONPath.prototype._stringify = _memoize(function(path) {
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
}, JSON.stringify)

JSONPath.prototype.stringify = function(path) {
  return this._stringify(path)
}

JSONPath.prototype._normalize = _memoize(function(path) {
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
}, JSON.stringify)

JSONPath.prototype.complexity = function(string){
  assert.ok(_is_string(string), "we need a path");

  const components = this.parser.parse(string);

  const expressions = components.filter(function(component){
    return component.expression.type == "script_expression" ||
           component.expression.type == "filter_expression"

  })

  const asts = expressions.map(function(expr){
    const start = expr.expression.type == "script_expression" ? 1 : 2
    return aesprim.parse(expr.expression.value.slice(start, -1)).body[0].expression
  })

  function add_tally(orig, add){
    orig.unary   += add.unary
    orig.binary  += add.binary
    orig.logical += add.logical

    return orig
  }

  function tally(obj){
    var obj_total = {
        unary : 0,
       binary : 0,
      logical : 0
    }

    if(obj.type == "UnaryExpression"){
      obj_total.unary += 1
      obj_total = add_tally(obj_total, tally(obj.argument))

    }else if(obj.type == "BinaryExpression"){
      obj_total.binary += 1
      obj_total = add_tally(add_tally(obj_total, tally(obj.left)),
                                                 tally(obj.right))

    }else if(obj.type == "LogicalExpression"){
      obj_total.logical += 1
      obj_total = add_tally(add_tally(obj_total, tally(obj.left)),
                                                 tally(obj.right))
    }

    return obj_total
  }

  var total = {
      unary : 0,
     binary : 0,
    logical : 0
  }

  for(var a = 0; a < asts.length; a += 1){
    const ast_total = tally(asts[a])
    total = add_tally(total, ast_total)
  }

  return {
     components : components.length,
    expressions : expressions.length,
          unary : total.unary,
         binary : total.binary,
        logical : total.logical
  }
}

function _is_string(obj) {
  return Object.prototype.toString.call(obj) == '[object String]';
}

JSONPath.Handlers = Handlers;
JSONPath.Parser = Parser;

var instance = new JSONPath;
instance.JSONPath = JSONPath;

module.exports = instance;
