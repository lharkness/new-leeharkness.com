'use strict';

// Add HTML pages here. Paths are relative to this script, for either entry point.
const pageBase = new URL('.', document.currentScript.src);
const files = {
  'readme.html': 'pages/readme.html',
  'about.html': 'pages/about.html',
  'links.html': 'pages/links.html'
};
const output = document.querySelector('#output');
const input = document.querySelector('#command');
const form = document.querySelector('#command-form');
const history = [];
let historyIndex = 0;
let draft = '';
const TYPE_DELAY_MS = 12;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const typingQueue = [];
let typingTimer;
let activeTyping;

function finishTyping() {
  clearTimeout(typingTimer);
  if (activeTyping) {
    for (const part of activeTyping.parts) part.node.textContent = part.text;
    activeTyping = null;
  }
  for (const entry of typingQueue.splice(0)) {
    for (const part of entry.parts) part.node.textContent = part.text;
  }
  output.setAttribute('aria-busy', 'false');
}

function clearScreen() {
  finishTyping();
  output.replaceChildren();
}

function typeNextCharacter() {
  if (!activeTyping) activeTyping = typingQueue.shift();
  if (!activeTyping) {
    output.setAttribute('aria-busy', 'false');
    return;
  }
  const part = activeTyping.parts.find(part => part.characters.length > part.shown);
  if (part) {
    part.node.textContent += part.characters[part.shown++];
    form.scrollIntoView({ block: 'nearest' });
    typingTimer = setTimeout(typeNextCharacter, TYPE_DELAY_MS);
  } else {
    activeTyping = null;
    typeNextCharacter();
  }
}

function renderText(container, value) {
  const pattern = /\[\[([^\]]+)\]\]|https?:\/\/[^\s<>]+/g;
  let end = 0;
  for (const match of value.matchAll(pattern)) {
    container.append(document.createTextNode(value.slice(end, match.index)));
    const link = document.createElement('a');
    if (match[1]) {
      link.textContent = match[1];
      link.href = '#cat=' + encodeURIComponent(match[1]);
      link.dataset.file = match[1];
    } else {
      link.textContent = match[0];
      link.href = match[0];
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    container.append(link);
    end = match.index + match[0].length;
  }
  container.append(document.createTextNode(value.slice(end)));
}

function animateEntry(entry) {
  if (reducedMotion.matches) return;
  const walker = document.createTreeWalker(entry, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const parts = nodes.map(node => {
    const text = node.textContent;
    node.textContent = '';
    return { node, text, characters: Array.from(text), shown: 0 };
  });
  typingQueue.push({ parts });
  output.setAttribute('aria-busy', 'true');
  if (!activeTyping) typeNextCharacter();
}

function print(value, className = '') {
  const entry = document.createElement('div');
  entry.className = 'entry ' + className;
  renderText(entry, value);
  output.append(entry);
  animateEntry(entry);
}

// Copy only supported content; page scripts, event handlers and styles stay out.
function copyPageContent(source, target) {
  const allowed = new Set(['P', 'BR', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'STRONG', 'EM', 'CODE', 'PRE', 'A']);
  for (const node of source.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      target.append(document.createTextNode(node.textContent));
    } else if (node.nodeType === Node.ELEMENT_NODE && allowed.has(node.tagName)) {
      const element = document.createElement(node.tagName.toLowerCase());
      if (node.tagName === 'A') {
        const href = node.getAttribute('href') || '';
        const file = href.replace(/^.*\//, '');
        if (Object.hasOwn(files, file)) {
          element.href = '#cat=' + encodeURIComponent(file);
          element.dataset.file = file;
        } else if (/^https?:\/\//i.test(href)) {
          element.href = href;
          element.target = '_blank';
          element.rel = 'noopener noreferrer';
        }
      }
      copyPageContent(node, element);
      target.append(element);
    }
  }
}

async function readPage(file, entry) {
  try {
    const response = await fetch(new URL(files[file], pageBase), { cache: 'no-cache' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const page = new DOMParser().parseFromString(await response.text(), 'text/html');
    // A clear command can remove the pending entry while the request is running.
    if (!entry.isConnected) return;
    entry.replaceChildren();
    copyPageContent(page.querySelector('main') || page.body, entry);
    animateEntry(entry);
  } catch {
    if (!entry.isConnected) return;
    entry.className = 'entry error';
    entry.textContent = location.protocol === 'file:'
      ? 'cat: serve this site over HTTP to load HTML pages. See README.md for local preview instructions.'
      : 'cat: ' + file + ': Could not load page. Try again.';
  }
}

function run(raw) {
  const command = raw.trim();
  if (!command) return;
  // Complete preceding output before a new command so transcripts stay ordered.
  finishTyping();
  history.push(command);
  historyIndex = history.length;
  draft = '';
  // User input is always text, never HTML or executable code.
  const line = document.createElement('div');
  line.className = 'entry command-line';
  line.textContent = 'visitor@site:~$ ' + command;
  output.append(line);
  const [name, ...args] = command.split(/\s+/);
  switch (name) {
    case 'help':
      print('help           Show available commands\nls             List files\ncat <file>     Read a file (or several)\nwhoami         Show visitor and browser details\nclear          Clear the screen\n\nUse ↑ / ↓ for command history, Tab to complete, Ctrl+L to clear.\n\nStart with cat [[readme.html]].');
      break;
    case 'whoami':
      print([
        'User: visitor',
        'IP: unavailable on this static site',
        'Language: ' + (navigator.language || 'unknown'),
        'Time zone: ' + (Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'),
        'User agent: ' + (navigator.userAgent || 'unknown'),
        '',
        'These details are reported by your browser.'
      ].join('\n'));
      break;
    case 'ls':
      print(Object.keys(files).map(file => '[[' + file + ']]').join('\n'));
      break;
    case 'cat':
      if (!args.length) print('Usage: cat <file>\nTry cat [[readme.html]].');
      for (let file of args) {
        file = file.replace(/^\.\//, '').replace(/\.txt$/, '.html');
        if (Object.hasOwn(files, file)) {
          const entry = document.createElement('div');
          entry.className = 'entry page';
          entry.textContent = 'Loading ' + file + '…';
          output.append(entry);
          readPage(file, entry);
        } else print('cat: ' + file + ': No such file', 'error');
      }
      break;
    case 'clear': clearScreen(); break;
    default: print(name + ': command not found. Type help for available commands.', 'error');
  }
  input.value = '';
  input.focus({ preventScroll: true });
  form.scrollIntoView({ block: 'nearest' });
}

form.addEventListener('submit', event => { event.preventDefault(); run(input.value); });
output.addEventListener('click', event => {
  const link = event.target.closest('a[data-file]');
  if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  run('cat ' + link.dataset.file);
});
input.addEventListener('keydown', event => {
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    if (historyIndex === history.length) draft = input.value;
    historyIndex = Math.max(0, Math.min(history.length, historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
    input.value = historyIndex === history.length ? draft : history[historyIndex];
    input.setSelectionRange(input.value.length, input.value.length);
  } else if (event.key === 'Tab') {
    // Keep Tab navigation available when there is nothing to complete.
    const parts = input.value.split(/\s+/);
    const prefix = parts.at(-1);
    if (!prefix) return;
    const choices = parts.length === 1 ? ['help', 'ls', 'cat', 'whoami', 'clear'] : Object.keys(files);
    const matches = choices.filter(item => item.startsWith(prefix));
    if (!matches.length) return;
    event.preventDefault();
    if (matches.length === 1) { parts[parts.length - 1] = matches[0]; input.value = parts.join(' ') + (parts.length === 1 ? ' ' : ''); }
  } else if (event.ctrlKey && event.key.toLowerCase() === 'l') {
    event.preventDefault(); clearScreen();
  }
});
document.querySelector('#terminal').addEventListener('click', event => {
  if (!event.target.closest('a') && !window.getSelection().toString()) input.focus({ preventScroll: true });
});
// A normal visit is blank. Explicit file links open the requested file.
function openLinkedFile() {
  if (location.hash.startsWith('#cat=')) {
    try { run('cat ' + decodeURIComponent(location.hash.slice(5))); }
    catch { print('Invalid file link.', 'error'); }
  }
}
window.addEventListener('hashchange', openLinkedFile);
reducedMotion.addEventListener('change', event => { if (event.matches) finishTyping(); });
openLinkedFile();
input.focus({ preventScroll: true });
