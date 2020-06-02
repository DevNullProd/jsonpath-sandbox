var _has = require('underscore').has;

// Copy of understore.memoize, with timestamp support
// and a few helper methods to retrieve cache keys and
// remove cache entries
module.exports = function(func, hasher) {
  var memoize = function(key) {
    var cache = memoize.cache;
    var timestamps = memoize.timestamps;
    var address = hasher ? hasher.apply(this, arguments) : key;
    if (!_has(cache, address)) cache[address] = func.apply(this, arguments);
    timestamps[address] = new Date() // set timestamp on access
    return cache[address];
  };

  memoize.cache = {};
  memoize.timestamps = {};
  memoize.hasher = hasher

  memoize.keys = function(){
    return Object.keys(memoize.cache);
  }

  memoize.remove = function(key){
    var address = hasher ? hasher.apply(this, arguments) : key;
    delete memoize.cache[key]
    delete memoize.timestamps[key]
  }

  return memoize;
};
