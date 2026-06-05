#!/usr/bin/env node

export async function main(): Promise<void> {
  // no-op for now
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
