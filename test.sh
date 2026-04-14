#!/usr/bin/env bash

if [ ! -d "./whatsapp-session" ]; then
  echo "❌ No session found. Run: node dist/index.js --setup"
  exit 1
fi

echo "✅ Running WhatsApp tests (single browser session)..."
node run-test.mjs
