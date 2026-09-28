import assert from "node:assert/strict";
import test from "node:test";

import { documentPlainText, isEffectivelyEmpty, type BodyElement } from "../src/modules/s13/doc-text";

const run = (text: string) => ({ textRun: { content: text } });
const para = (text: string): BodyElement => ({ paragraph: { elements: [run(text)] } });
const cell = (text: string): BodyElement => ({ paragraph: { elements: [run(text)] } });

test("paragraphs join into lines, in order, trimmed", () => {
  const text = documentPlainText([para("Instrucciones\n"), para("Paso 1: hacer esto\n"), para("")]);
  assert.equal(text, "Instrucciones\nPaso 1: hacer esto");
});

test("una tabla se aplana fila por fila, celdas separadas por ' | '", () => {
  const body: BodyElement[] = [
    para("Titulo"),
    {
      table: {
        tableRows: [
          { tableCells: [{ content: [cell("Num.")] }, { content: [cell("Ultima fecha")] }] },
          { tableCells: [{ content: [cell("1")] }, { content: [cell("18-8-26")] }] },
        ],
      },
    },
    para("Pie de pagina"),
  ];
  assert.equal(documentPlainText(body), "Titulo\nNum. | Ultima fecha\n1 | 18-8-26\n\nPie de pagina");
});

test("celdas vacias no generan una fila fantasma", () => {
  const body: BodyElement[] = [{ table: { tableRows: [{ tableCells: [{ content: [] }, { content: [] }] }] } }];
  assert.equal(documentPlainText(body), "");
});

test("isEffectivelyEmpty detecta cuando no hay texto real (solo separadores de tabla)", () => {
  assert.equal(isEffectivelyEmpty(""), true);
  assert.equal(isEffectivelyEmpty("  | |  \n |"), true);
  assert.equal(isEffectivelyEmpty("algo"), false);
});
