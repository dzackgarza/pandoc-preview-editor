#!/usr/bin/env node
import { setTimeout } from 'node:timers/promises';
import { readFileSync, writeFileSync } from 'node:fs';

// Read the content passed via stdin
const input = readFileSync(0, 'utf-8');

// Wait for 2 seconds to simulate slow render
await setTimeout(2000);

// Output a simple HTML version
console.log(`<!DOCTYPE html>
<html>
<head><title>Slow Render</title></head>
<body>${input.replace(/^# (.*)$/gm, '<h1>$1</h1>').replace(/\n/g, '<br>')}</body>
</html>`);
