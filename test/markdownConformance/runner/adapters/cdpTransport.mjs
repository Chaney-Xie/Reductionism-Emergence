import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';

export const CDP_MODIFIERS = Object.freeze({
  ALT: 1,
  CTRL: 2,
  CONTROL: 2,
  META: 4,
  COMMAND: 4,
  SHIFT: 8
});

const NAMED_KEYS = Object.freeze({
  Backspace: ['Backspace', 'Backspace', 8],
  Tab: ['Tab', 'Tab', 9],
  Enter: ['Enter', 'Enter', 13],
  Escape: ['Escape', 'Escape', 27],
  Space: [' ', 'Space', 32],
  PageUp: ['PageUp', 'PageUp', 33],
  PageDown: ['PageDown', 'PageDown', 34],
  End: ['End', 'End', 35],
  Home: ['Home', 'Home', 36],
  ArrowLeft: ['ArrowLeft', 'ArrowLeft', 37],
  ArrowUp: ['ArrowUp', 'ArrowUp', 38],
  ArrowRight: ['ArrowRight', 'ArrowRight', 39],
  ArrowDown: ['ArrowDown', 'ArrowDown', 40],
  Delete: ['Delete', 'Delete', 46]
});

const PUNCTUATION_KEYS = Object.freeze({
  '`': ['Backquote', 192, false],
  '~': ['Backquote', 192, true],
  '-': ['Minus', 189, false],
  '_': ['Minus', 189, true],
  '=': ['Equal', 187, false],
  '+': ['Equal', 187, true],
  '[': ['BracketLeft', 219, false],
  '{': ['BracketLeft', 219, true],
  ']': ['BracketRight', 221, false],
  '}': ['BracketRight', 221, true],
  '\\': ['Backslash', 220, false],
  '|': ['Backslash', 220, true],
  ';': ['Semicolon', 186, false],
  ':': ['Semicolon', 186, true],
  "'": ['Quote', 222, false],
  '"': ['Quote', 222, true],
  ',': ['Comma', 188, false],
  '<': ['Comma', 188, true],
  '.': ['Period', 190, false],
  '>': ['Period', 190, true],
  '/': ['Slash', 191, false],
  '?': ['Slash', 191, true]
});

const SHIFTED_DIGITS = Object.freeze({
  '!': '1',
  '@': '2',
  '#': '3',
  '$': '4',
  '%': '5',
  '^': '6',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0'
});

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class CdpError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CdpError';
    this.details = details;
  }
}

export class CdpEvaluationError extends CdpError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = 'CdpEvaluationError';
  }
}

function boundedLogAppend(current, chunk, limit = 2_000_000) {
  const next = `${current}${String(chunk)}`;
  return next.length <= limit ? next : next.slice(next.length - limit);
}

export function modifiersMask(value = 0) {
  if (Number.isInteger(value)) return value;
  const names = Array.isArray(value)
    ? value
    : Object.entries(value || {}).filter(([, enabled]) => enabled).map(([name]) => name);
  return names.reduce((mask, name) => {
    const normalized = String(name).replace(/^cmd$/i, 'COMMAND').toUpperCase();
    return mask | (CDP_MODIFIERS[normalized] || 0);
  }, 0);
}

function printableKeyDescriptor(character) {
  if (character === ' ') {
    return { key: ' ', code: 'Space', virtualKeyCode: 32, modifiers: 0 };
  }
  if (/^[a-z]$/i.test(character)) {
    const upper = character.toUpperCase();
    return {
      key: character,
      code: `Key${upper}`,
      virtualKeyCode: upper.charCodeAt(0),
      modifiers: character === upper ? CDP_MODIFIERS.SHIFT : 0
    };
  }
  if (/^[0-9]$/.test(character)) {
    return {
      key: character,
      code: `Digit${character}`,
      virtualKeyCode: character.charCodeAt(0),
      modifiers: 0
    };
  }
  if (Object.hasOwn(SHIFTED_DIGITS, character)) {
    const digit = SHIFTED_DIGITS[character];
    return {
      key: character,
      code: `Digit${digit}`,
      virtualKeyCode: digit.charCodeAt(0),
      modifiers: CDP_MODIFIERS.SHIFT
    };
  }
  const punctuation = PUNCTUATION_KEYS[character];
  if (punctuation) {
    const [code, virtualKeyCode, shifted] = punctuation;
    return {
      key: character,
      code,
      virtualKeyCode,
      modifiers: shifted ? CDP_MODIFIERS.SHIFT : 0
    };
  }
  return null;
}

function namedKeyDescriptor(key) {
  const tuple = NAMED_KEYS[key];
  if (tuple) {
    return { key: tuple[0], code: tuple[1], virtualKeyCode: tuple[2], modifiers: 0 };
  }
  if (/^[a-z]$/i.test(key)) return printableKeyDescriptor(key);
  if (/^[0-9]$/.test(key)) return printableKeyDescriptor(key);
  return null;
}

export async function requestCdpJson(port, pathname = '/json/list', {
  timeoutMs = 1_000,
  host = '127.0.0.1'
} = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host, port, path: pathname }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if ((response.statusCode || 500) >= 400) {
          reject(new CdpError(`CDP endpoint returned HTTP ${response.statusCode}.`, {
            pathname,
            body: body.slice(0, 2_000)
          }));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new CdpError(`CDP endpoint returned invalid JSON: ${error.message}`, {
            pathname,
            body: body.slice(0, 2_000)
          }));
        }
      });
    });
    request.once('error', reject);
    request.setTimeout(timeoutMs, () => request.destroy(new CdpError('CDP endpoint timed out.')));
  });
}

export async function allocateLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!port) throw new CdpError('Could not allocate a loopback CDP port.');
  return port;
}

export class CdpClient {
  constructor(webSocketUrl, { commandTimeoutMs = 20_000 } = {}) {
    this.webSocketUrl = webSocketUrl;
    this.commandTimeoutMs = commandTimeoutMs;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.events = [];
    this.socket = null;
  }

  async connect() {
    if (typeof WebSocket !== 'function') {
      throw new CdpError('This adapter requires a Node runtime with a global WebSocket implementation.');
    }
    if (this.socket) return this;
    const socket = new WebSocket(this.webSocketUrl);
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const waiter = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.error) {
          waiter.reject(new CdpError(`CDP ${waiter.method} failed: ${JSON.stringify(message.error)}`, {
            method: waiter.method,
            error: message.error
          }));
        } else {
          waiter.resolve(message.result);
        }
        return;
      }
      this.events.push(message);
      if (this.events.length > 10_000) this.events.shift();
      for (const listener of this.listeners.get(message.method) || []) listener(message.params, message);
    });
    socket.addEventListener('close', () => {
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new CdpError(`CDP socket closed while waiting for ${waiter.method}.`));
      }
      this.pending.clear();
    });
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return this;
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  send(method, params = {}, { timeoutMs = this.commandTimeoutMs } = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new CdpError(`Cannot send ${method}: CDP socket is not open.`));
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpError(`CDP ${method} timed out after ${timeoutMs} ms.`, { method }));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, {
    awaitPromise = true,
    returnByValue = true,
    userGesture = true,
    timeoutMs
  } = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue,
      userGesture
    }, { timeoutMs });
    if (result.exceptionDetails) {
      const exception = result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || 'Runtime evaluation failed.';
      throw new CdpEvaluationError(exception, { expression, exceptionDetails: result.exceptionDetails });
    }
    if (!result.result) return undefined;
    if (Object.hasOwn(result.result, 'value')) return result.result.value;
    return result.result.unserializableValue ?? result.result.description;
  }

  async waitForValue(expression, {
    timeoutMs = 10_000,
    intervalMs = 50,
    description = 'runtime condition'
  } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastValue;
    while (Date.now() < deadline) {
      lastValue = await this.evaluate(expression);
      if (lastValue) return lastValue;
      await delay(intervalMs);
    }
    throw new CdpError(`Timed out waiting for ${description}.`, { expression, lastValue });
  }

  async dispatchKey(key, { modifiers = 0, text, autoRepeat = false } = {}) {
    const descriptor = namedKeyDescriptor(key) || printableKeyDescriptor(key);
    if (!descriptor) throw new CdpError(`Unsupported physical key: ${key}`);
    const effectiveModifiers = modifiersMask(modifiers) | descriptor.modifiers;
    const common = {
      key: descriptor.key,
      code: descriptor.code,
      modifiers: effectiveModifiers,
      windowsVirtualKeyCode: descriptor.virtualKeyCode,
      nativeVirtualKeyCode: descriptor.virtualKeyCode,
      autoRepeat
    };
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      ...common,
      ...(text !== undefined ? { text, unmodifiedText: text } : {})
    });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
  }

  async typeText(value) {
    for (const character of Array.from(String(value))) {
      if (character === '\n') {
        await this.dispatchKey('Enter');
        continue;
      }
      if (character === '\t') {
        await this.dispatchKey('Tab');
        continue;
      }
      const descriptor = printableKeyDescriptor(character);
      if (!descriptor) {
        await this.insertText(character);
        continue;
      }
      await this.dispatchKey(character, { text: character });
    }
  }

  insertText(text) {
    return this.send('Input.insertText', { text: String(text) });
  }

  async click({ x, y, button = 'left', clickCount = 1, modifiers = 0 }) {
    const point = { x: Number(x), y: Number(y) };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new CdpError('Trusted click requires finite x/y viewport coordinates.');
    }
    const mask = modifiersMask(modifiers);
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...point,
      button: 'none',
      buttons: 0,
      modifiers: mask
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...point,
      button,
      buttons: button === 'left' ? 1 : button === 'right' ? 2 : 4,
      clickCount,
      modifiers: mask
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...point,
      button,
      buttons: 0,
      clickCount,
      modifiers: mask
    });
  }

  async drag(start, end, { steps = 16, durationMs = 240, modifiers = 0 } = {}) {
    const from = { x: Number(start?.x), y: Number(start?.y) };
    const to = { x: Number(end?.x), y: Number(end?.y) };
    if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) {
      throw new CdpError('Trusted drag requires finite start/end viewport coordinates.');
    }
    const mask = modifiersMask(modifiers);
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...from,
      button: 'left',
      buttons: 1,
      clickCount: 1,
      modifiers: mask
    });
    for (let index = 1; index <= steps; index += 1) {
      const ratio = index / steps;
      await this.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: from.x + ((to.x - from.x) * ratio),
        y: from.y + ((to.y - from.y) * ratio),
        button: 'left',
        buttons: 1,
        modifiers: mask
      });
      await delay(Math.max(0, durationMs / steps));
    }
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...to,
      button: 'left',
      buttons: 0,
      clickCount: 1,
      modifiers: mask
    });
  }

  close() {
    if (!this.socket) return;
    this.socket.close();
    this.socket = null;
  }
}

export class LaunchedCdpProcess {
  constructor(options) {
    this.options = options;
    this.child = null;
    this.client = null;
    this.port = null;
    this.target = null;
    this.targets = [];
    this.log = '';
  }

  static async launch(options) {
    const process = new LaunchedCdpProcess(options);
    await process.start();
    return process;
  }

  async start() {
    if (this.child) return this;
    const {
      executablePath,
      args = [],
      cwd = globalThis.process.cwd(),
      env = globalThis.process.env,
      port = await allocateLoopbackPort(),
      timeoutMs = 30_000,
      targetPredicate = (target) => target.type === 'page'
    } = this.options;
    this.port = port;
    const resolvedArgs = typeof args === 'function' ? args({ port }) : args;
    if (!Array.isArray(resolvedArgs)) {
      throw new CdpError('CDP process args must be an array or an args factory.');
    }
    const child = spawn(executablePath, resolvedArgs, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    this.child = child;
    child.stdout?.on('data', (chunk) => { this.log = boundedLogAppend(this.log, chunk); });
    child.stderr?.on('data', (chunk) => { this.log = boundedLogAppend(this.log, chunk); });
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new CdpError(`Application exited before a CDP renderer became available (${child.exitCode}).`, {
          executablePath,
          log: this.log
        });
      }
      try {
        const targets = await requestCdpJson(port);
        this.targets = targets;
        const target = targets.find(targetPredicate);
        if (target?.webSocketDebuggerUrl) {
          this.target = target;
          this.client = await new CdpClient(target.webSocketDebuggerUrl).connect();
          await this.client.send('Runtime.enable');
          await this.client.send('Page.enable');
          return this;
        }
      } catch (error) {
        lastError = error;
      }
      await delay(100);
    }
    throw new CdpError('Timed out waiting for an eligible CDP renderer target.', {
      executablePath,
      port,
      lastError: lastError?.message,
      targets: this.targets,
      log: this.log
    });
  }

  async stop({ timeoutMs = 5_000 } = {}) {
    this.client?.close();
    this.client = null;
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(timeoutMs)
    ]);
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        delay(1_000)
      ]);
    }
  }
}

function shortcutModifier(platform) {
  return platform === 'darwin' ? CDP_MODIFIERS.META : CDP_MODIFIERS.CTRL;
}

function canonicalAction(action) {
  if (typeof action === 'string') return { type: 'key', chord: action };
  if (!action || typeof action !== 'object') throw new CdpError('Scenario action must be a string or object.');
  return { ...action, type: action.type || action.kind || action.op };
}

export async function dispatchTrustedAction(client, rawAction, { platform = globalThis.process.platform } = {}) {
  const action = canonicalAction(rawAction);
  const type = String(action.type || '').toLowerCase();
  if (type === 'sequence') {
    for (const step of action.steps || []) {
      const handled = await dispatchTrustedAction(client, step, { platform });
      if (!handled) return false;
    }
    return true;
  }
  if (type === 'input' && String(action.command || '').toLowerCase() === 'inserttext') {
    await client.typeText(action.text ?? action.value ?? '');
    return true;
  }
  if (['type', 'text', 'typetext'].includes(type)) {
    await client.typeText(action.text ?? action.value ?? '');
    return true;
  }
  if (['inserttext', 'insert-text'].includes(type)) {
    await client.insertText(action.text ?? action.value ?? '');
    return true;
  }
  if ((type === 'click' || (type === 'mouse' && action.command === 'click'))
    && Number.isFinite(Number(action.x)) && Number.isFinite(Number(action.y))) {
    await client.click(action);
    return true;
  }
  if (type === 'drag' && action.start && action.end) {
    await client.drag(action.start, action.end, action);
    return true;
  }
  if (type === 'wait') {
    await delay(Math.max(0, Number(action.ms ?? action.milliseconds) || 0));
    return true;
  }

  const chord = action.chord || action.key || (type === 'key' ? action.value : null);
  if (!chord && ['undo', 'redo', 'save'].includes(type)) {
    action.chord = type === 'undo' ? 'Undo' : type === 'redo' ? 'Redo' : 'Save';
  }
  const resolvedChord = action.chord || chord;
  if (!resolvedChord) return false;
  const aliases = {
    undo: { key: 'z', modifiers: shortcutModifier(platform) },
    redo: { key: 'z', modifiers: shortcutModifier(platform) | CDP_MODIFIERS.SHIFT },
    save: { key: 's', modifiers: shortcutModifier(platform) }
  };
  const alias = aliases[String(resolvedChord).toLowerCase()];
  if (alias) {
    await client.dispatchKey(alias.key, alias);
    return true;
  }
  const pieces = String(resolvedChord).split('+').map((piece) => piece.trim()).filter(Boolean);
  const key = pieces.pop();
  const chordModifiers = pieces.reduce((mask, piece) => mask | modifiersMask([piece]), 0);
  const actionModifierNames = (Array.isArray(action.modifiers) ? action.modifiers : [])
    .map((name) => String(name).toLowerCase() === 'platform-primary'
      ? (platform === 'darwin' ? 'command' : 'control')
      : name);
  const booleanModifiers = [
    action.shiftKey && 'shift',
    action.altKey && 'alt',
    action.ctrlKey && 'control',
    action.metaKey && 'command'
  ].filter(Boolean);
  await client.dispatchKey(key, {
    modifiers: chordModifiers | modifiersMask([...actionModifierNames, ...booleanModifiers]),
    ...(Object.hasOwn(action, 'text') ? { text: action.text } : {})
  });
  return true;
}

export { delay as cdpDelay };
