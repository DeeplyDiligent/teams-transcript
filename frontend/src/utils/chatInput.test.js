import test from 'node:test'
import assert from 'node:assert/strict'
import { getChatInputAction } from './chatInput.js'

const enter = { key: 'Enter' }

test('desktop Enter sends', () => {
  assert.equal(getChatInputAction(enter, false), 'send')
})

test('Ctrl+Enter explicitly inserts a newline on desktop and mobile', () => {
  for (const mobile of [false, true]) {
    assert.equal(getChatInputAction({ ...enter, ctrlKey: true }, mobile), 'newline')
  }
})

test('mobile Enter keeps the native textarea newline', () => {
  assert.equal(getChatInputAction(enter, true), 'default')
})

test('Shift+Enter keeps the native textarea newline', () => {
  assert.equal(getChatInputAction({ ...enter, shiftKey: true }, false), 'default')
})

test('IME composition and other keys never submit', () => {
  assert.equal(getChatInputAction({ ...enter, isComposing: true }, false), 'default')
  assert.equal(getChatInputAction({ ...enter, keyCode: 229 }, false), 'default')
  assert.equal(getChatInputAction({ key: 'a' }, false), 'default')
})
