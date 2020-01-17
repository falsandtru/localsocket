# ClientChannel

[![Build Status](https://travis-ci.org/falsandtru/clientchannel.svg?branch=master)](https://travis-ci.org/falsandtru/clientchannel)
[![Coverage Status](https://coveralls.io/repos/falsandtru/clientchannel/badge.svg?branch=master&service=github)](https://coveralls.io/github/falsandtru/clientchannel?branch=master)

Store and sync data between tabs via IndexedDB or LocalStorage.

## Features

- Store and restore data using IndexedDB or LocalStorage.
- Cross data binding between tabs.
- Individual expiration per data.

## Demos

Store and sync text and canvas.

https://falsandtru.github.io/clientchannel/

## APIs

[index.d.ts](index.d.ts)

## Usage

### Persist data

A schema is defined by properties of objects made by the registered factory function.
Property names having underscore(`_`) prefix or postfix will be excluded from schema.
Property values of linked objects will be stored by update.
Linked objects will be updated automatically when a linked object is updated on another thread(tab).

```ts
import { StoreChannel, StoreChannelObject, ChannelObject } from 'clientchannel';

interface Value extends StoreChannelObject<string> {
}
class Value {
  // Getter and setter names will be excluded from schema.
  get key() {
    return this[ChannelObject.key];
  }
  // Properties having an invalid name will be excluded from schema.
  private _separator = ' ';
  // Only properties having a valid name and a storable value consist schema.
  firstName = '';
  lastName = '';
  // Properties having an invalid value will be excluded from schema.
  name() {
    return this.firstName + this._separator + this.lastName;
  }
}

const chan = new StoreChannel('domain', {
  schema: () => new Value(),
  // Delete records of update events of a linked object 3 days later since the last access.
  age: 3 * 24 * 60 * 60 * 1e3,
});
// Load data from IndexedDB with little delay.
const link = chan.link('path');
// Save data to IndexedDB, and sync data between all tabs.
link.firstName = 'john';
link.lastName = 'smith';
```

### Communication and Synchronization

Linked objects provede send/recv events.
`send` event will be emitted when a linked object was updated by own thread(tab).
`recv` event will be emitted when a linked object was updated by another thread(tab).

```ts
import { StorageChannel, StorageChannelObject } from 'clientchannel';

interface Value extends StorageChannelObject {
}
class Value {
  get event() {
    return this[ChannelObject.event];
  }
  version = 0;
}

const chan = new StorageChannel('version', {
  schema: () => new Value(),
});
const link = chan.link();
const VERSION = 1;
link.event.on(['recv', 'version'], ({ newValue }) => {
  if (newValue === VERSION) return;
  if (newValue > VERSION) {
    location.reload(true);
  }
  else {
    link.version = VERSION;
  }
});
link.version = VERSION;
```

## Browsers

Requires es6 and modern DOM API support.

- Chrome
- Firefox
- Edge (Chromium edition only)
- Safari

Polyfill: https://cdn.polyfill.io
