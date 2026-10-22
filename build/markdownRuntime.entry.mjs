import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown } from 'mdast-util-math';

import highlightCore from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import java from 'highlight.js/lib/languages/java';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import matlab from 'highlight.js/lib/languages/matlab';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import latex from 'highlight.js/lib/languages/latex';

import katex from 'katex';
import 'katex/contrib/mhchem';

const markdownExtensions = Object.freeze([gfm(), math()]);
const markdownAstExtensions = Object.freeze([gfmFromMarkdown(), mathFromMarkdown()]);

const languageDefinitions = [
  { id: 'plaintext', label: 'Plain Text', aliases: ['text', 'txt'], grammar: null },
  { id: 'javascript', label: 'JavaScript', aliases: ['js', 'jsx', 'mjs', 'cjs'], grammar: javascript },
  { id: 'typescript', label: 'TypeScript', aliases: ['ts', 'tsx'], grammar: typescript },
  { id: 'json', label: 'JSON', aliases: ['jsonc'], grammar: json },
  { id: 'xml', label: 'HTML/XML', aliases: ['html', 'htm', 'svg'], grammar: xml },
  { id: 'css', label: 'CSS', aliases: ['scss', 'less'], grammar: css },
  { id: 'python', label: 'Python', aliases: ['py'], grammar: python },
  { id: 'r', label: 'R', aliases: [], grammar: r },
  { id: 'bash', label: 'Bash/Shell', aliases: ['sh', 'shell', 'zsh'], grammar: bash },
  { id: 'sql', label: 'SQL', aliases: [], grammar: sql },
  { id: 'java', label: 'Java', aliases: [], grammar: java },
  { id: 'c', label: 'C', aliases: ['h'], grammar: c },
  { id: 'cpp', label: 'C++', aliases: ['c++', 'cc', 'cxx', 'hpp'], grammar: cpp },
  { id: 'csharp', label: 'C#', aliases: ['cs'], grammar: csharp },
  { id: 'rust', label: 'Rust', aliases: ['rs'], grammar: rust },
  { id: 'go', label: 'Go', aliases: ['golang'], grammar: go },
  { id: 'matlab', label: 'MATLAB', aliases: [], grammar: matlab },
  { id: 'markdown', label: 'Markdown', aliases: ['md'], grammar: markdown },
  { id: 'yaml', label: 'YAML', aliases: ['yml'], grammar: yaml },
  { id: 'latex', label: 'LaTeX', aliases: ['tex'], grammar: latex }
];

const languageMetadata = Object.freeze(languageDefinitions.map(({ id, label, aliases }) => (
  Object.freeze({ id, label, aliases: Object.freeze([...aliases]) })
)));

const languageByAlias = new Map();
languageDefinitions.forEach((definition) => {
  languageByAlias.set(definition.id, definition);
  definition.aliases.forEach((alias) => languageByAlias.set(alias, definition));
  if (!definition.grammar) return;
  highlightCore.registerLanguage(definition.id, definition.grammar);
  if (definition.aliases.length) {
    highlightCore.registerAliases(definition.aliases, { languageName: definition.id });
  }
});

function parseMarkdown(source) {
  return fromMarkdown(String(source ?? ''), {
    extensions: markdownExtensions,
    mdastExtensions: markdownAstExtensions
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function resolveCodeLanguage(declaredLanguage) {
  const declared = String(declaredLanguage ?? '').trim();
  if (!declared) {
    const plain = languageByAlias.get('plaintext');
    return {
      id: plain.id,
      label: plain.label,
      aliases: [...plain.aliases],
      declaredLanguage: '',
      known: true
    };
  }
  const definition = languageByAlias.get(declared.toLowerCase());
  if (!definition) {
    return {
      id: null,
      label: declared,
      aliases: [],
      declaredLanguage: declared,
      known: false
    };
  }
  return {
    id: definition.id,
    label: definition.label,
    aliases: [...definition.aliases],
    declaredLanguage: declared,
    known: true
  };
}

function highlightCode(source, declaredLanguage) {
  const code = String(source ?? '');
  const language = resolveCodeLanguage(declaredLanguage);
  const highlighted = language.known && language.id !== 'plaintext'
    ? highlightCore.highlight(code, {
      language: language.id,
      ignoreIllegals: true
    }).value
    : escapeHtml(code);
  return {
    value: highlighted,
    html: highlighted,
    language: language.id || '',
    displayName: language.label,
    declaredLanguage: language.declaredLanguage,
    known: language.known
  };
}

function renderLatex(source, options = {}) {
  return katex.renderToString(String(source ?? ''), {
    displayMode: options.displayMode === true,
    throwOnError: false,
    strict: 'warn',
    trust: false,
    output: 'htmlAndMathml'
  });
}

const api = Object.freeze({
  parseMarkdown,
  highlightCode,
  renderLatex,
  resolveCodeLanguage,
  languageMetadata
});

if (typeof globalThis !== 'undefined') globalThis.markdownRuntime = api;

export {
  parseMarkdown,
  highlightCode,
  renderLatex,
  resolveCodeLanguage,
  languageMetadata
};

export default api;
