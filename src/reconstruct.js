#!/usr/bin/env node
// The second-reader test: given ONLY a decision-evidence document, re-derive the decision
// and compare every hash. No network, no other file.
//
//   node src/reconstruct.js <decision-evidence.json> [--json]
// Exit 0 when the stated decision follows from the embedded artifacts, 1 when it does not.
import { readFile } from 'node:fs/promises';
import { reconstructDecision, formatReconstruction } from 'revivecheck/decision';

const [file] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
if (!file) { console.error('Usage: node src/reconstruct.js <decision-evidence.json> [--json]'); process.exit(2); }
const document = JSON.parse(await readFile(file, 'utf8'));
const result = reconstructDecision(document);
console.log(process.argv.includes('--json') ? JSON.stringify(result, null, 2) : formatReconstruction(result, file));
process.exitCode = result.ok ? 0 : 1;
