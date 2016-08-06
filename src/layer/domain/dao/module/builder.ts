import { isValidName, isValidValue } from '../../../data/constraint/values';
import { noop } from '../../../../lib/noop';

export {
  isValidName as isValidPropertyName,
  isValidValue as isValidPropertyValue
}

export const SCHEMA = {
  META: {
    NAME: '__meta'
  },
  ID: {
    NAME: '__id'
  },
  KEY: {
    NAME: '__key'
  },
  DATE: {
    NAME: '__date'
  },
  EVENT: {
    NAME: '__event'
  }
};

export function build<V>(source: V, factory: () => V, update: (attr: string, newVal: any, oldVal: any) => void = noop): V {
  const dao: V = factory();
  void Object.keys(SCHEMA)
    .map(prop => SCHEMA[prop].NAME)
    .reduce((_, prop) => { delete dao[prop] }, void 0);
  if (typeof source[SCHEMA.KEY.NAME] !== 'string') throw new TypeError(`LocalSocket: Invalid key: ${source[SCHEMA.KEY.NAME]}`);
  const descmap: PropertyDescriptorMap = Object.assign(Object.keys(dao)
    .filter(isValidName)
    .filter(isValidValue(dao))
    .reduce<PropertyDescriptorMap>((map, prop) => {
      {
        const desc = Object.getOwnPropertyDescriptor(dao, prop)
        if (desc && (desc.get || desc.set)) return map;
      }
      const iniVal = dao[prop];
      if (source[prop] === void 0) {
        source[prop] = iniVal;
      }
      map[prop] = {
        enumerable: true,
        get: () => source[prop] === void 0 ? iniVal : source[prop],
        set: newVal => {
          const oldVal = source[prop];
          if (!isValidValue(source)(prop)) return;
          source[prop] = newVal === void 0 ? iniVal : newVal;
          void update(prop, newVal, oldVal);
        }
      };
      return map;
    }, {}), {
      [SCHEMA.META.NAME]: {
        configurable: false,
        enumerable: false,
        get: () => source[SCHEMA.META.NAME]
      },
      [SCHEMA.ID.NAME]: {
        configurable: false,
        enumerable: false,
        get: () => source[SCHEMA.ID.NAME]
      },
      [SCHEMA.KEY.NAME]: {
        configurable: false,
        enumerable: false,
        get: () => source[SCHEMA.KEY.NAME]
      },
      [SCHEMA.DATE.NAME]: {
        configurable: false,
        enumerable: false,
        get: () => source[SCHEMA.DATE.NAME]
      },
      [SCHEMA.EVENT.NAME]: {
        configurable: false,
        enumerable: false,
        get: () => source[SCHEMA.EVENT.NAME]
      }
    });
  void Object.defineProperties(dao, descmap);
  void Object.seal(dao);
  return dao;
}
