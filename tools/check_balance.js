const fs = require('fs');
const path = process.argv[2];
if (!path) { console.error('Usage: node check_balance.js <file>'); process.exit(2); }
const txt = fs.readFileSync(path, 'utf8');
let line = 1;
const issues = [];
let stack = [];
const pairs = { '{': '}', '(': ')', '[': ']' };
for (let i = 0; i < txt.length; i++) {
  const ch = txt[i];
  if (ch === '\n') { line++; }
  if (ch === '"' || ch === "'") {
    // skip string literal
    const quote = ch; i++;
    while (i < txt.length && txt[i] !== quote) {
      if (txt[i] === '\\') i++; // skip escaped
      i++;
    }
    continue;
  }
  if (ch === '`') {
    // template literal, skip until closing backtick, but count ${ ... }
    i++;
    while (i < txt.length) {
      if (txt[i] === '$' && txt[i+1] === '{') { stack.push({ch:'${', line}); i+=2; continue; }
      if (txt[i] === '}') {
        // close ${
        if (stack.length && stack[stack.length-1].ch === '${') stack.pop();
      }
      if (txt[i] === '`') break;
      if (txt[i] === '\\') i++;
      if (txt[i] === '\n') line++;
      i++;
    }
    continue;
  }
  if (ch === '/' && txt[i+1] === '/') {
    // skip line comment
    while (i < txt.length && txt[i] !== '\n') i++;
    continue;
  }
  if (ch === '/' && txt[i+1] === '*') {
    // skip block comment
    i+=2;
    while (i < txt.length && !(txt[i] === '*' && txt[i+1] === '/')) {
      if (txt[i] === '\n') line++;
      i++;
    }
    i++;
    continue;
  }
  if (ch === '{' || ch === '(' || ch === '[') {
    stack.push({ch, line});
  } else if (ch === '}' || ch === ')' || ch === ']') {
    const last = stack.pop();
    if (!last) {
      issues.push({type: 'unmatched_close', char: ch, line});
    } else {
      const expected = pairs[last.ch];
      if (expected !== ch) issues.push({type:'mismatch', open: last.ch, openLine: last.line, close: ch, line});
    }
  }
}
while (stack.length) { issues.push({type:'unclosed', open: stack.pop()}); }
if (issues.length === 0) {
  console.log('No balance issues detected');
  process.exit(0);
}
console.log('Found issues:', issues.length);
issues.forEach((it, idx) => {
  console.log(idx+1, JSON.stringify(it));
});
process.exit(0);
