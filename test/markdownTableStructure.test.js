const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');

function cellSources(cells) {
  return Array.from(cells, (cell) => cell.source);
}

function rowSources(rows) {
  return Array.from(rows, cellSources);
}

function tableNode(source) {
  const stack = [markdown.parseMarkdownDocument(source)];
  while (stack.length) {
    const node = stack.shift();
    if (node?.type === 'table') return node;
    stack.unshift(...(node?.children || []));
  }
  return null;
}

const RICH_TABLE = [
  '| **Molecule** | `Role\\|Kind` | [Site](https://example.com/a\\|b) |',
  '| :--- | :---: | ---: |',
  '| ATP | *Fuel* | **Cytosol** |'
].join('\n');

test('table structure uses positioned AST ranges and preserves exact cell Markdown', () => {
  const source = `Before\n\n${RICH_TABLE}\n\nAfter`;
  const start = source.indexOf('| **Molecule**');
  const table = markdown.parseMarkdownTableStructure(source, start);

  assert.ok(table);
  assert.equal(table.start, start);
  assert.equal(source.slice(table.start, table.end), RICH_TABLE);
  assert.deepEqual(Array.from(table.alignments), ['left', 'center', 'right']);
  assert.deepEqual(cellSources(table.header), [
    '**Molecule**', '`Role\\|Kind`', '[Site](https://example.com/a\\|b)'
  ]);
  assert.deepEqual(Array.from(table.header, (cell) => cell.sortText), [
    'Molecule', 'Role|Kind', 'Site'
  ]);
  assert.deepEqual(rowSources(table.rows), [['ATP', '*Fuel*', '**Cytosol**']]);
  table.header.forEach((cell) => {
    assert.equal(source.slice(cell.start, cell.end), cell.source);
    assert.ok(cell.outerStart <= cell.start);
    assert.ok(cell.outerEnd >= cell.end);
  });
  assert.equal(Object.isFrozen(table), true);
  assert.equal(Object.isFrozen(table.header), true);
  assert.equal(Object.isFrozen(table.header[0]), true);
});

test('a structural move preserves escaped pipes, inline code, links, emphasis, and empty cells', () => {
  const tableSource = [
    'Name | `Code\\|Pipe` | [Link](https://example.com/a\\|b "Title")',
    '--- | :---: | ---:',
    'A\\|B | **bold** | '
  ].join('\r\n');
  const source = `Prelude\r\n\r\n${tableSource}\r\n\r\nEpilogue`;
  const start = source.indexOf('Name |');
  const parsed = markdown.parseMarkdownTableStructure(source, start);

  assert.deepEqual(cellSources(parsed.header), [
    'Name', '`Code\\|Pipe`', '[Link](https://example.com/a\\|b "Title")'
  ]);
  assert.deepEqual(rowSources(parsed.rows), [['A\\|B', '**bold**', '']]);
  const result = markdown.applyMarkdownTableOperation(source, start, {
    type: 'move-column', fromIndex: 0, toIndex: 2
  });

  assert.deepEqual(cellSources(result.table.header), [
    '`Code\\|Pipe`', '[Link](https://example.com/a\\|b "Title")', 'Name'
  ]);
  assert.deepEqual(rowSources(result.table.rows), [['**bold**', '', 'A\\|B']]);
  assert.deepEqual(Array.from(result.table.alignments), ['center', 'right', null]);
  assert.equal(result.source.slice(0, result.start), 'Prelude\r\n\r\n');
  assert.equal(result.source.slice(result.nextEnd), '\r\n\r\nEpilogue');
  assert.equal(result.table.lineEnding, '\r\n');
  assert.equal(
    markdown.parseMarkdownDocument(result.source).children.filter((node) => node.type === 'table').length,
    1,
    'the rewritten cell source remains one valid GFM table'
  );
});

test('append row and column preserve rich cells through the structural serializer', () => {
  const source = `Before exact\n\n${RICH_TABLE}\n\nAfter exact`;
  const start = source.indexOf('| **Molecule**');
  const original = markdown.parseMarkdownTableStructure(source, start);
  const before = source.slice(0, original.start);
  const after = source.slice(original.end);

  const column = markdown.applyMarkdownTableOperation(source, start, {
    type: 'append-column'
  });
  assert.equal(column.source.slice(0, column.start), before);
  assert.equal(column.source.slice(column.nextEnd), after);
  assert.deepEqual(cellSources(column.table.header), [
    '**Molecule**', '`Role\\|Kind`', '[Site](https://example.com/a\\|b)', ''
  ]);
  assert.deepEqual(rowSources(column.table.rows), [
    ['ATP', '*Fuel*', '**Cytosol**', '']
  ]);
  assert.deepEqual(Array.from(column.table.alignments), ['left', 'center', 'right', null]);
  assert.equal(column.replacement.split('\n')[1], '| :--- | :---: | ---: | --- |');

  const row = markdown.applyMarkdownTableOperation(source, start, {
    type: 'append-row'
  });
  assert.equal(row.source.slice(0, row.start), before);
  assert.equal(row.source.slice(row.nextEnd), after);
  assert.deepEqual(cellSources(row.table.header), cellSources(original.header));
  assert.deepEqual(rowSources(row.table.rows), [
    ['ATP', '*Fuel*', '**Cytosol**'],
    ['', '', '']
  ]);
  assert.deepEqual(Array.from(row.table.alignments), ['left', 'center', 'right']);
  assert.equal(tableNode(row.source)?.type, 'table');
});

test('uneven and empty rows are padded without dropping existing cells', () => {
  const source = [
    '| A || C |',
    '| --- | --- | --- |',
    '| X |',
    '| 1 | 2 | 3 | 4 |'
  ].join('\n');
  const table = markdown.parseMarkdownTableStructure(source, 0);

  assert.equal(table.columnCount, 4);
  assert.deepEqual(cellSources(table.header), ['A', '', 'C', '']);
  assert.deepEqual(rowSources(table.rows), [
    ['X', '', '', ''],
    ['1', '2', '3', '4']
  ]);
  assert.deepEqual(Array.from(table.alignments), [null, null, null, null]);
  assert.equal(markdown.serializeMarkdownTableStructure(table), [
    '| A |  | C |  |',
    '| --- | --- | --- | --- |',
    '| X |  |  |  |',
    '| 1 | 2 | 3 | 4 |'
  ].join('\n'));
});

test('serialization preserves CRLF and a nested blockquote continuation prefix', () => {
  const tableSource = [
    '> | A | B |',
    '> | --- | --- |',
    '> | X | Y |'
  ].join('\r\n');
  const source = `${tableSource}\r\n\r\nAfter`;
  const start = source.indexOf('| A');
  const parsed = markdown.parseMarkdownTableStructure(source, start);

  assert.equal(parsed.lineEnding, '\r\n');
  assert.equal(parsed.continuationPrefix, '> ');
  const result = markdown.applyMarkdownTableOperation(source, start, { type: 'append-row' });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.source, [
    '> | A | B |',
    '> | --- | --- |',
    '> | X | Y |',
    '> |  |  |',
    '',
    'After'
  ].join('\r\n'));
  assert.equal(tableNode(result.source)?.type, 'table');
  assert.equal(result.table.continuationPrefix, '> ');
});

test('serialization preserves list continuation indentation and unrelated bytes', () => {
  const source = [
    'Intro',
    '',
    '- | A | B |',
    '  | --- | --- |',
    '  | X | Y |',
    '',
    'After'
  ].join('\n');
  const start = source.indexOf('| A');
  const table = markdown.parseMarkdownTableStructure(source, start);
  assert.equal(table.continuationPrefix, '  ');

  const result = markdown.applyMarkdownTableOperation(source, start, {
    type: 'insert-row', index: 0
  });
  assert.equal(result.source.slice(0, result.start), source.slice(0, table.start));
  assert.equal(result.source.slice(result.nextEnd), source.slice(table.end));
  assert.match(result.source, /- \| A \| B \|\n  \| --- \| --- \|\n  \|  \|  \|\n  \| X \| Y \|/);
  const root = markdown.parseMarkdownDocument(result.source);
  assert.equal(root.children[1].type, 'list');
  assert.equal(root.children[1].children[0].children[0].type, 'table');
});

test('a compound blockquote/list prefix and a header-only table remain nested after append', () => {
  const compound = [
    '> - | A | B |',
    '>   | --- | --- |',
    '>   | X | Y |'
  ].join('\n');
  const compoundStart = compound.indexOf('| A');
  const compoundTable = markdown.parseMarkdownTableStructure(compound, compoundStart);
  assert.equal(compoundTable.continuationPrefix, '>   ');
  const compoundResult = markdown.applyMarkdownTableOperation(compound, compoundStart, {
    type: 'append-row'
  });
  assert.match(compoundResult.source, /\n>   \|  \|  \|$/);
  assert.equal(tableNode(compoundResult.source)?.type, 'table');

  const headerOnly = ['> | H1 | H2 |', '> | --- | --- |'].join('\n');
  const headerStart = headerOnly.indexOf('| H1');
  const headerTable = markdown.parseMarkdownTableStructure(headerOnly, headerStart);
  assert.equal(headerTable.rows.length, 0);
  assert.equal(headerTable.continuationPrefix, '> ');
  const headerResult = markdown.applyMarkdownTableOperation(headerOnly, headerStart, {
    type: 'append-row'
  });
  assert.equal(headerResult.source, [
    '> | H1 | H2 |',
    '> | --- | --- |',
    '> |  |  |'
  ].join('\n'));
  assert.equal(tableNode(headerResult.source)?.type, 'table');
});

test('the requested Table range is the only range rewritten when several Tables exist', () => {
  const first = ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n');
  const second = ['Left | Right', ':--- | ---:', 'L | R'].join('\n');
  const source = `Before\n\n${first}\n\nBetween bytes !@#\n\n${second}\n\nAfter`;
  const secondStart = source.indexOf('Left | Right');
  const parsed = markdown.parseMarkdownTableStructure(source, secondStart);
  const before = source.slice(0, parsed.start);
  const after = source.slice(parsed.end);
  const result = markdown.applyMarkdownTableOperation(source, secondStart, {
    type: 'insert-column', index: 1
  });

  assert.equal(result.source.slice(0, result.start), before);
  assert.equal(result.source.slice(result.nextEnd), after);
  assert.ok(result.source.includes(first), 'the first Table stays byte-for-byte exact');
  assert.ok(result.source.includes('Between bytes !@#'));
  assert.deepEqual(cellSources(result.table.header), ['Left', '', 'Right']);
});

test('row operations append, insert, and move complete body rows immutably', () => {
  const source = [
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '| 3 | 4 |'
  ].join('\n');
  const original = markdown.parseMarkdownTableStructure(source, 0);
  const snapshot = JSON.stringify(original);

  const inserted = markdown.applyMarkdownTableOperation(source, 0, {
    type: 'insert-row', index: 1
  });
  assert.deepEqual(rowSources(inserted.table.rows), [
    ['1', '2'], ['', ''], ['3', '4']
  ]);
  assert.equal(Object.hasOwn(inserted, 'selection'), false);

  const moved = markdown.applyMarkdownTableOperation(source, 0, {
    type: 'move-row', fromIndex: 0, toIndex: 1
  });
  assert.deepEqual(rowSources(moved.table.rows), [['3', '4'], ['1', '2']]);
  assert.equal(Object.hasOwn(moved, 'selection'), false);

  const appended = markdown.applyMarkdownTableOperation(source, 0, { type: 'append-row' });
  assert.deepEqual(rowSources(appended.table.rows).at(-1), ['', '']);
  assert.equal(Object.hasOwn(appended, 'selection'), false);
  assert.equal(JSON.stringify(original), snapshot, 'operations do not mutate their parsed input');
});

test('column operations move header, body and alignment as one structural unit', () => {
  const source = [
    '| Molecule | Role | Compartment |',
    '| :--- | :---: | ---: |',
    '| Glucose | Fuel | Cytosol |',
    '| DNA | Information | Nucleus |'
  ].join('\n');

  const moved = markdown.applyMarkdownTableOperation(source, 0, {
    type: 'move-column', fromIndex: 1, toIndex: 2
  });
  assert.deepEqual(cellSources(moved.table.header), ['Molecule', 'Compartment', 'Role']);
  assert.deepEqual(Array.from(moved.table.alignments), ['left', 'right', 'center']);
  assert.deepEqual(rowSources(moved.table.rows), [
    ['Glucose', 'Cytosol', 'Fuel'],
    ['DNA', 'Nucleus', 'Information']
  ]);
  assert.equal(Object.hasOwn(moved, 'selection'), false);

  const inserted = markdown.applyMarkdownTableOperation(source, 0, {
    type: 'insert-column', index: 1
  });
  assert.deepEqual(cellSources(inserted.table.header), ['Molecule', '', 'Role', 'Compartment']);
  assert.deepEqual(rowSources(inserted.table.rows)[0], ['Glucose', '', 'Fuel', 'Cytosol']);
  assert.equal(Object.hasOwn(inserted, 'selection'), false);

  const appended = markdown.applyMarkdownTableOperation(source, 0, { type: 'append-column' });
  assert.deepEqual(cellSources(appended.table.header).at(-1), '');
  assert.equal(appended.table.columnCount, 4);
  assert.equal(Object.hasOwn(appended, 'selection'), false);
});

test('alignment rewrites only the selected column using one stable convention', () => {
  const source = [
    '| A | B | C |',
    '| --- | --- | --- |',
    '| 1 | 2 | 3 |'
  ].join('\n');
  const result = markdown.applyMarkdownTableOperation(source, 0, {
    type: 'set-alignment', columnIndex: 1, alignment: 'centre'
  });

  assert.deepEqual(Array.from(result.table.alignments), [null, 'center', null]);
  assert.equal(result.replacement.split('\n')[1], '| --- | :---: | --- |');
  assert.equal(Object.hasOwn(result, 'selection'), false);

  const unchanged = markdown.applyMarkdownTableOperation(result.source, result.start, {
    type: 'set-alignment', columnIndex: 1, alignment: 'center'
  });
  assert.equal(unchanged.ok, true);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.source, result.source);

  const invalid = markdown.applyMarkdownTableOperation(result.source, result.start, {
    type: 'set-alignment', columnIndex: 1, alignment: 'bogus'
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.changed, false);
  assert.equal(invalid.source, result.source);
  assert.deepEqual(Array.from(invalid.table.alignments), [null, 'center', null]);
});

test('alphabetical row sorting uses semantic text, keeps ties stable, and leaves empty values last', () => {
  const source = [
    '| Label | Payload |',
    '| --- | --- |',
    '| **beta** | beta-row |',
    '| [Alpha](https://example.com/a) | alpha-link |',
    '| `alpha` | alpha-code |',
    '| *Gamma* | gamma-row |',
    '|  | empty-row |'
  ].join('\n');

  const ascending = markdown.applyMarkdownTableOperation(source, 0, {
    type: 'sort-rows',
    columnIndex: 0,
    sort: 'alphabetical',
    direction: 'asc'
  });
  assert.equal(ascending.ok, true);
  assert.equal(ascending.changed, true);
  assert.deepEqual(rowSources(ascending.table.rows), [
    ['[Alpha](https://example.com/a)', 'alpha-link'],
    ['`alpha`', 'alpha-code'],
    ['**beta**', 'beta-row'],
    ['*Gamma*', 'gamma-row'],
    ['', 'empty-row']
  ]);

  const descending = markdown.applyMarkdownTableOperation(source, 0, {
    type: 'sort-rows',
    columnIndex: 0,
    sort: 'alphabetical',
    direction: 'desc'
  });
  assert.deepEqual(rowSources(descending.table.rows), [
    ['*Gamma*', 'gamma-row'],
    ['**beta**', 'beta-row'],
    ['[Alpha](https://example.com/a)', 'alpha-link'],
    ['`alpha`', 'alpha-code'],
    ['', 'empty-row']
  ]);
});

test('numeric row sorting accepts only complete finite decimals and preserves invalid groups stably', () => {
  const source = [
    '| Value | Payload |',
    '| ---: | --- |',
    '| 10 | ten |',
    '| **2** | two-markup |',
    '| 2.0 | two-decimal |',
    '| -3 | negative |',
    '| 1e2 | exponent |',
    '| .5 | fraction |',
    '| 12x | text-suffix |',
    '| 1,000 | text-comma |',
    '| Infinity | text-infinity |',
    '| 1e309 | text-nonfinite |',
    '|  | empty-first |',
    '|  | empty-second |'
  ].join('\n');

  const ascending = markdown.applyMarkdownTableOperation(source, 0, {
    type: 'sort-rows',
    columnIndex: 0,
    sort: 'numeric',
    direction: 'asc'
  });
  assert.deepEqual(rowSources(ascending.table.rows).map((row) => row[1]), [
    'negative', 'fraction', 'two-markup', 'two-decimal', 'ten', 'exponent',
    'text-suffix', 'text-comma', 'text-infinity', 'text-nonfinite',
    'empty-first', 'empty-second'
  ]);

  const descending = markdown.applyMarkdownTableOperation(source, 0, {
    type: 'sort-rows',
    columnIndex: 0,
    sort: 'numeric',
    direction: 'desc'
  });
  assert.deepEqual(rowSources(descending.table.rows).map((row) => row[1]), [
    'exponent', 'ten', 'two-markup', 'two-decimal', 'fraction', 'negative',
    'text-suffix', 'text-comma', 'text-infinity', 'text-nonfinite',
    'empty-first', 'empty-second'
  ]);
});

test('row sorting preserves exact escaped, inline, link, emphasis, LaTeX, and empty cell source', () => {
  const source = [
    '| Key | Escaped | Code | Link | Emphasis | Math | Empty |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| B | A\\|B | `x\\|y` | [Label](https://example.com/a\\|b "Title") | **bold** | $\\alpha + 2$ | |',
    '| A | C\\|D | `p\\|q` | [Other](https://example.com/c\\|d) | *italic* | $x^2$ | |'
  ].join('\n');
  const sorted = markdown.applyMarkdownTableOperation(source, 0, {
    type: 'sort-rows',
    columnIndex: 0,
    sort: 'alphabetical',
    direction: 'asc'
  });

  assert.deepEqual(rowSources(sorted.table.rows), [
    ['A', 'C\\|D', '`p\\|q`', '[Other](https://example.com/c\\|d)', '*italic*', '$x^2$', ''],
    ['B', 'A\\|B', '`x\\|y`', '[Label](https://example.com/a\\|b "Title")', '**bold**', '$\\alpha + 2$', '']
  ]);
  assert.equal(tableNode(sorted.source)?.type, 'table');
  assert.equal(sorted.source.includes('A\\|B'), true);
  assert.equal(sorted.source.includes('`x\\|y`'), true);
  assert.equal(sorted.source.includes('$\\alpha + 2$'), true);
});

test('numeric column sorting fixes the first-column axis and moves complete aligned columns', () => {
  const source = [
    '| Item | A | B | C |',
    '| :--- | ---: | :---: | --- |',
    '| X | 7 | 2 | 5 |',
    '| Y | p | q | r |'
  ].join('\n');

  const ascending = markdown.applyMarkdownTableOperation(source, 0, {
    type: 'sort-columns',
    rowIndex: 0,
    sort: 'numeric',
    direction: 'asc'
  });
  assert.deepEqual(cellSources(ascending.table.header), ['Item', 'B', 'C', 'A']);
  assert.deepEqual(Array.from(ascending.table.alignments), ['left', 'center', null, 'right']);
  assert.deepEqual(rowSources(ascending.table.rows), [
    ['X', '2', '5', '7'],
    ['Y', 'q', 'r', 'p']
  ]);

  const descending = markdown.applyMarkdownTableOperation(source, 0, {
    type: 'sort-columns',
    rowIndex: 0,
    sort: 'numeric',
    direction: 'desc'
  });
  assert.deepEqual(cellSources(descending.table.header), ['Item', 'A', 'C', 'B']);
  assert.deepEqual(Array.from(descending.table.alignments), ['left', 'right', null, 'center']);
  assert.deepEqual(rowSources(descending.table.rows), [
    ['X', '7', '5', '2'],
    ['Y', 'p', 'r', 'q']
  ]);
});

test('Header-row alphabetical column sorting keeps the top-left axis and stable equal columns fixed', () => {
  const source = [
    '| Axis | **beta** | [Alpha](https://example.com/a) | `alpha` | Gamma |',
    '| :--- | ---: | :---: | --- | :--- |',
    '| Row | beta-value | alpha-link | alpha-code | gamma-value |'
  ].join('\n');

  const ascending = markdown.applyMarkdownTableOperation(source, 0, {
    type: 'sort-columns',
    rowIndex: -1,
    sort: 'alphabetical',
    direction: 'asc'
  });
  assert.deepEqual(cellSources(ascending.table.header), [
    'Axis', '[Alpha](https://example.com/a)', '`alpha`', '**beta**', 'Gamma'
  ]);
  assert.deepEqual(Array.from(ascending.table.alignments), [
    'left', 'center', null, 'right', 'left'
  ]);
  assert.deepEqual(rowSources(ascending.table.rows), [[
    'Row', 'alpha-link', 'alpha-code', 'beta-value', 'gamma-value'
  ]]);

  const descending = markdown.applyMarkdownTableOperation(source, 0, {
    type: 'sort-columns',
    rowIndex: -1,
    sort: 'alphabetical',
    direction: 'desc'
  });
  assert.deepEqual(cellSources(descending.table.header), [
    'Axis', 'Gamma', '**beta**', '[Alpha](https://example.com/a)', '`alpha`'
  ]);
  assert.deepEqual(rowSources(descending.table.rows), [[
    'Row', 'gamma-value', 'beta-value', 'alpha-link', 'alpha-code'
  ]]);
});

test('one-row and one-column sorts are valid no-ops without obsolete selection metadata', () => {
  const source = ['| Axis |', '| --- |', '| 7 |'].join('\n');
  const operations = [
    {
      type: 'sort-rows', columnIndex: 0, sort: 'alphabetical', direction: 'asc'
    },
    {
      type: 'sort-columns', rowIndex: 0, sort: 'numeric', direction: 'desc'
    }
  ];

  operations.forEach((operation) => {
    const result = markdown.applyMarkdownTableOperation(source, 0, operation);
    assert.equal(result.ok, true);
    assert.equal(result.changed, false);
    assert.equal(result.source, source);
    assert.equal(Object.hasOwn(result, 'selection'), false);
  });
});

test('invalid table operations and missing tables do not rewrite source', () => {
  const source = '| A |\n| --- |\n| X |';
  const invalid = markdown.applyMarkdownTableOperation(source, 0, {
    type: 'move-row', fromIndex: 2, toIndex: 0
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.changed, false);
  assert.equal(invalid.source, source);

  for (const operation of [
    { type: 'sort-rows', columnIndex: 1, sort: 'alphabetical', direction: 'asc' },
    { type: 'sort-rows', columnIndex: 0, sort: 'automatic', direction: 'asc' },
    { type: 'sort-columns', rowIndex: 2, sort: 'numeric', direction: 'desc' },
    { type: 'sort-columns', rowIndex: 0, sort: 'numeric', direction: 'sideways' }
  ]) {
    const result = markdown.applyMarkdownTableOperation(source, 0, operation);
    assert.equal(result.ok, false);
    assert.equal(result.changed, false);
    assert.equal(result.source, source);
    assert.equal(Object.hasOwn(result, 'selection'), false);
  }

  const missing = markdown.applyMarkdownTableOperation('No table', 0, {
    type: 'append-row'
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.changed, false);
  assert.equal(missing.source, 'No table');
  assert.equal(Object.hasOwn(missing, 'selection'), false);
});
