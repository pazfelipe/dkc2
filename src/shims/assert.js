// Minimal stand-in for Node's `assert` (needed by xbrz-js in the browser).
function assert(v, msg) {
  if (!v) throw new Error(msg || "assertion failed");
}
assert.equal = (a, b, msg) => assert(a == b, msg || `${a} != ${b}`);
module.exports = assert;
