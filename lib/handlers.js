var aesprim = require('./aesprim');
var codegen = require('escodegen')
var slice = require('./slice');
var _memoize = require('./memoize')

var VEight = require('v-eight').VEight;
var _uniq = require('underscore').uniq

// XXX: if this appears in a filter expression, this won't work
const _AT_SYMBOL_ = '_AT_SYMBOL_'

var Handlers = function() {
  return this.initialize.apply(this, arguments);
}

Handlers.prototype.initialize = function() {
  this.traverse = traverser(true);
  this.descend = traverser();
}

Handlers.prototype.resolve = function(component) {
  var key = [ component.operation, component.scope, component.expression.type ].join('-');
  var method = this._fns[key];

  if (!method) throw new Error("couldn't resolve key: " + key);
  return method.bind(this);
};

Handlers.prototype._fns = {

  'member-child-identifier': function(component, partial) {
    var key = component.expression.value;
    var value = partial.value;
    if (value instanceof Object && key in value)
      return [ {value: value[key], path: partial.path.concat(key) } ]
  },

  'member-descendant-identifier':
    _traverse(function(key, value, ref) { return key == ref }),

  'subscript-child-numeric_literal':
    _descend(function(key, value, ref) { return key === ref }),

  'member-child-numeric_literal':
    _descend(function(key, value, ref) { return String(key) === String(ref) }),

  'subscript-descendant-numeric_literal':
    _traverse(function(key, value, ref) { return key === ref }),

  'member-child-wildcard':
    _descend(function() { return true }),

  'member-descendant-wildcard':
    _traverse(function() { return true }),

  'subscript-descendant-wildcard':
    _traverse(function() { return true }),

  'subscript-child-wildcard':
    _descend(function() { return true }),

  'subscript-child-slice': function(component, partial) {
    if (is_array(partial.value)) {
      var args = component.expression.value.split(':').map(_parse_nullable_int);
      var values = partial.value.map(function(v, i) { return { value: v, path: partial.path.concat(i) } });
      return slice.apply(null, [values].concat(args));
    }
  },

  'subscript-child-union': function(component, partial) {
    var results = [];
    for(var v = 0; v < component.expression.value.length; v += 1){
      const value = component.expression.value[v]
      var _component = { operation: 'subscript', scope: 'child', expression: value.expression };
      var handler = this.resolve(_component);

      var _results = handler(_component, partial);
      if (_results) {
        results = results.concat(_results);
      }
    }

    return unique(results);
  },

  'subscript-descendant-union': function(component, partial, count) {
    var jp = require('./index');
    var self = this;

    var results = [];
    var nodes = jp.nodes(partial, '$..*').slice(1);

    for(var n = 0; n < nodes.length; n += 1){
      const node = nodes[n]
      if (results.length >= count) break;
      for(var v = 0; v < component.expression.value.length; v += 1){
        const value = component.expression.value[v]
        var _component = { operation: 'subscript', scope: 'child', expression: value.expression };
        var handler = self.resolve(_component);
        var _results = handler(_component, node);
        results = results.concat(_results);
      }
    }

    return unique(results);
  },

  'subscript-child-filter_expression': function(component, partial, count) {
    // slice out the expression from ?(expression)
    var src = component.expression.value.slice(2, -1);
    var expression = this._replace_at(src)

    var passable = function(key, value) {
      return this._evaluate(expression, { _AT_SYMBOL_: value });
    }.bind(this)

    return this.descend(partial, null, passable, count);
  },

  'subscript-descendant-filter_expression': function(component, partial, count) {
    // slice out the expression from ?(expression)
    var src = component.expression.value.slice(2, -1);
    var expression = this._replace_at(src)

    var passable = function(key, value) {
      return this._evaluate(expression, { _AT_SYMBOL_: value });
    }.bind(this)

    return this.traverse(partial, null, passable, count);
  },

  'subscript-child-script_expression': function(component, partial) {
    var exp = component.expression.value.slice(1, -1);
    return this._eval_recurse(partial, exp, '$[{{value}}]');
  },

  'member-child-script_expression': function(component, partial) {
    var exp = component.expression.value.slice(1, -1);
    return this._eval_recurse(partial, exp, '$.{{value}}');
  },

  'member-descendant-script_expression': function(component, partial) {
    var exp = component.expression.value.slice(1, -1);
    return this._eval_recurse(partial, exp, '$..value');
  }
};

Handlers.prototype._eval_recurse = function(partial, src, template) {
  var jp = require('./index');
  var expression = this._replace_at(src)
  var value = this._evaluate(expression, { _AT_SYMBOL_: partial.value })
  var path = template.replace(/\{\{\s*value\s*\}\}/g, value);

  var results = jp.nodes(partial.value, path);
  for(var ri = 0; ri < results.length; ri += 1){
    results[ri].path = partial.path.concat(results[ri].path.slice(1));
  }

  return results;
}

Handlers.prototype._evaluate = function(expression, globals) {
  // Create v8 engine JIT for expression evaluation
  if(!this.v8){
    this.v8 = new VEight()
  }

  if(this.expression_timeout)
    this.v8.timeout(this.expression_timeout)

  const code = (Object.keys(globals).map(function(g){
                 return g + '=' + JSON.stringify(globals[g])
                }).concat([expression])).join("\n")

  this.v8.reset()
  return this.v8.execute(code)
}

Handlers.prototype._replace_at = _memoize(function(src){
  var ast = aesprim.parse(src).body[0].expression;

  function search_and_replace(_ast){
    if(_ast.type                 &&
       _ast.type == "Identifier" &&
       _ast.name == "@")
       _ast.name = _AT_SYMBOL_

    const keys = Object.keys(_ast)
    for(var a = 0; a < keys.length; a += 1){
      const key = keys[a]
      if(typeof(_ast[key]) === "object")
        search_and_replace(_ast[key])
    }

    return _ast
  }

  return codegen.generate(search_and_replace(ast))
})

Handlers.prototype._fns['subscript-child-string_literal'] =
	Handlers.prototype._fns['member-child-identifier'];

Handlers.prototype._fns['member-descendant-numeric_literal'] =
    Handlers.prototype._fns['subscript-descendant-string_literal'] =
    Handlers.prototype._fns['member-descendant-identifier'];

function is_array(val) {
  return Array.isArray(val);
}

function is_object(val) {
  // is this a non-array, non-null object?
  return val && !(val instanceof Array) && val instanceof Object;
}

function traverser(recurse) {
  return function(partial, ref, passable, count) {
    var value = partial.value;
    var path = partial.path;

    var results = [];

    var descend = function(value, path) {
      if (is_array(value)) {
        for(var index = 0; index < value.length; index += 1){
          const element = value[index]
          if (results.length >= count) { break }
          if (passable(index, element, ref)) {
            results.push({ path: path.concat(index), value: element });
          }
        };

        for(var index = 0; index < value.length; index += 1){
          const element = value[index]
          if (results.length >= count) { break }
          if (recurse) {
            descend(element, path.concat(index));
          }
        };

      } else if (is_object(value)) {
        const keys = Object.keys(value)
        for(var ki = 0; ki < keys.length; ki += 1){
          const k = keys[ki]
          if (results.length >= count) { break }
          if (passable(k, value[k], ref)) {
            results.push({ path: path.concat(k), value: value[k] });
          }
        }

        for(var ki = 0; ki < keys.length; ki += 1){
          const k = keys[ki]
          if (results.length >= count) { break }
          if (recurse) {
            descend(value[k], path.concat(k));
          }
        };
      }
    }.bind(this);

    descend(value, path);

    return results;
  }
}

function _descend(passable) {
  return function(component, partial, count) {
    return this.descend(partial, component.expression.value, passable, count);
  }
}

function _traverse(passable) {
  return function(component, partial, count) {
    return this.traverse(partial, component.expression.value, passable, count);
  }
}

function unique(results) {
  results = results.filter(function(d) { return d })
  return _uniq(
    results,
    function(r) { return r.path.map(function(c) { return String(c).replace('-', '--') }).join('-') }
  );
}

function _parse_nullable_int(val) {
  var sval = String(val);
  return sval.match(/^-?[0-9]+$/) ? parseInt(sval) : null;
}

module.exports = Handlers;
