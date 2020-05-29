var aesprim = require('./aesprim');
var codegen = require('escodegen')
var slice = require('./slice');
var Sandbox = require('v8-sandbox').default;
var _uniq = require('underscore').uniq;

// XXX: if this appears in a filter expression, this won't work
const _AT_SYMBOL_ = '_AT_SYMBOL_'

var Handlers = function() {
  return this.initialize.apply(this, arguments);
}

Handlers.prototype.initialize = function() {
  this.traverse = traverser(true);
  this.descend = traverser();
}

Handlers.prototype.shutdown = function(){
  if(this.sandbox)
    return this.sandbox.shutdown()
  return Promise.resolve()
}

Handlers.prototype.resolve = function(component) {

  var key = [ component.operation, component.scope, component.expression.type ].join('-');
  var method = this._fns[key];

  if (!method) throw new Error("couldn't resolve key: " + key);
  return method.bind(this);
};

Handlers.prototype._fns = {

  'member-child-identifier': function(component, partial) {
    return new Promise(function(resolve){
      var key = component.expression.value;
      var value = partial.value;
      if (value instanceof Object && key in value)
        resolve ([ {value: value[key], path: partial.path.concat(key) } ])

      else
        resolve()
    })
  },

  'member-descendant-identifier':
    _traverse(async function(key, value, ref) { return { value : key == ref } }),

  'subscript-child-numeric_literal':
    _descend(async function(key, value, ref) { return { value : key === ref } }),

  'member-child-numeric_literal':
    _descend(async function(key, value, ref) { return { value : String(key) === String(ref) } }),

  'subscript-descendant-numeric_literal':
    _traverse(async function(key, value, ref) { return { value : key === ref } }),

  'member-child-wildcard':
    _descend(async function() { return { value : true } }),

  'member-descendant-wildcard':
    _traverse(async function() { return { value : true } }),

  'subscript-descendant-wildcard':
    _traverse(async function() { return { value : true } }),

  'subscript-child-wildcard':
    _descend(async function() { return { value : true } }),

  'subscript-child-slice': function(component, partial) {
    return new Promise(function(resolve){
      if (is_array(partial.value)) {
        var args = component.expression.value.split(':').map(_parse_nullable_int);
        var values = partial.value.map(function(v, i) { return { value: v, path: partial.path.concat(i) } });
        resolve(slice.apply(null, [values].concat(args)));
      }
    })
  },

  'subscript-child-union': function(component, partial) {
    return new Promise(async function(resolve){
      var results = [];
      for(var v = 0; v < component.expression.value.length; v += 1){
        const value = component.expression.value[v]
        var _component = { operation: 'subscript', scope: 'child', expression: value.expression };
        var handler = this.resolve(_component);

        var _results = await handler(_component, partial);
        if (_results) {
          results = results.concat(_results);
        }
      }

      resolve(unique(results));
    }.bind(this))
  },

  'subscript-descendant-union': function(component, partial, count) {
    return new Promise(async function(resolve){
      var jp = require('./index');
      var self = this;

      var results = [];
      var nodes = (await jp.nodes(partial, '$..*')).slice(1);

      for(var n = 0; n < nodes.length; n += 1){
        const node = nodes[n]
        if (results.length >= count) break;
        for(var v = 0; v < component.expression.value.length; v += 1){
          const value = component.expression.value[v]
          var _component = { operation: 'subscript', scope: 'child', expression: value.expression };
          var handler = self.resolve(_component);
          var _results = await handler(_component, node);
          results = results.concat(_results);
        }
      }

      resolve(unique(results));
    }.bind(this))
  },

  'subscript-child-filter_expression': function(component, partial, count) {
    return new Promise(async function(resolve){
      // slice out the expression from ?(expression)
      var src = component.expression.value.slice(2, -1);
      var expression = _replace_at(src)

      var passable = function(key, value) {
        return evaluate.bind(this)(expression, { _AT_SYMBOL_: value });
      }.bind(this)

      resolve(await this.descend(partial, null, passable, count));
    }.bind(this))
  },

  'subscript-descendant-filter_expression': function(component, partial, count) {
    return new Promise(async function(resolve){
      // slice out the expression from ?(expression)
      var src = component.expression.value.slice(2, -1);
      var expression = _replace_at(src)

      var passable = function(key, value) {
        return evaluate.bind(this)(expression, { _AT_SYMBOL_: value });
      }.bind(this)

      resolve(await this.traverse(partial, null, passable, count));
    }.bind(this))
  },

  'subscript-child-script_expression': function(component, partial) {
    return new Promise(async function(resolve){
      var exp = component.expression.value.slice(1, -1);
      resolve(await eval_recurse.bind(this)(partial, exp, '$[{{value}}]'));
    }.bind(this))
  },

  'member-child-script_expression': function(component, partial) {
    return new Promise(async function(resolve){
      var exp = component.expression.value.slice(1, -1);
      resolve(await eval_recurse.bind(this)(partial, exp, '$.{{value}}'));
    }.bind(this))
  },

  'member-descendant-script_expression': function(component, partial) {
    return new Promise(async function(resolve){
      var exp = component.expression.value.slice(1, -1);
      resolve(await eval_recurse.bind(this)(partial, exp, '$..value'));
    }.bind(this))
  }
};

Handlers.prototype._fns['subscript-child-string_literal'] =
	Handlers.prototype._fns['member-child-identifier'];

Handlers.prototype._fns['member-descendant-numeric_literal'] =
    Handlers.prototype._fns['subscript-descendant-string_literal'] =
    Handlers.prototype._fns['member-descendant-identifier'];

async function eval_recurse(partial, src, template) {
  var jp = require('./index');
  var expression = _replace_at(src)
  var value = (await evaluate.bind(this)(expression, { _AT_SYMBOL_: partial.value })).value;
  var path = template.replace(/\{\{\s*value\s*\}\}/g, value);

  var results = await jp.nodes(partial.value, path);
  for(var ri = 0; ri < results.length; ri += 1){
    results[ri].path = partial.path.concat(results[ri].path.slice(1));
  }

  return results;
}

function is_array(val) {
  return Array.isArray(val);
}

function is_object(val) {
  // is this a non-array, non-null object?
  return val && !(val instanceof Array) && val instanceof Object;
}

function traverser(recurse) {
  return async function(partial, ref, passable, count) {
    var value = partial.value;
    var path = partial.path;

    var results = [];

    var descend = async function(value, path) {
      if (is_array(value)) {
        for(var index = 0; index < value.length; index += 1){
          const element = value[index]
          if (results.length >= count) { break }
          if ((await passable(index, element, ref)).value) {
            results.push({ path: path.concat(index), value: element });
          }
        };

        for(var index = 0; index < value.length; index += 1){
          const element = value[index]
          if (results.length >= count) { break }
          if (recurse) {
            await descend(element, path.concat(index));
          }
        };

      } else if (is_object(value)) {
        const keys = Object.keys(value)
        for(var ki = 0; ki < keys.length; ki += 1){
          const k = keys[ki]
          if (results.length >= count) { break }
          if ((await passable(k, value[k], ref)).value) {
            results.push({ path: path.concat(k), value: value[k] });
          }
        }

        for(var ki = 0; ki < keys.length; ki += 1){
          const k = keys[ki]
          if (results.length >= count) { break }
          if (recurse) {
            await descend(value[k], path.concat(k));
          }
        };
      }
    }.bind(this);

    await descend(value, path);

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

function evaluate(expression, globals) {
  // Create sandbox JIT for expression evaluation
  if(!this.sandbox)
    this.sandbox = new Sandbox()

  var code = 'setResult({value:' + expression + '})';
  var execute = {
    code, globals,
    httpEnabled: false,
    timersEnabled: false
  }

  return this.sandbox.execute(execute)
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

function _replace_at(src){
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
}

module.exports = Handlers;
