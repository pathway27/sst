import { Context } from "@serverless-stack/node/context/index.js";
import { Logger } from "../logger/index.js";
import crypto from "crypto";

export interface Events {}

export type EventTypes = keyof Events;

export type EventPayload<Type extends EventTypes = EventTypes> = {
  type: Type;
  sourceID: string;
  properties: Events[Type];
};

type Subscription = {
  type: EventTypes;
  cb: (payload: any) => void;
};

export const useBus = Context.memo(() => {
  const subscriptions: Record<string, Subscription[]> = {};

  function subscribers(type: EventTypes) {
    let arr = subscriptions[type];
    if (!arr) {
      arr = [];
      subscriptions[type] = arr;
    }
    return arr;
  }

  const sourceID = crypto.randomBytes(16).toString("hex");

  return {
    sourceID,
    publish<Type extends EventTypes>(type: Type, properties: Events[Type]) {
      const payload: EventPayload<Type> = {
        type,
        properties,
        sourceID,
      };

      Logger.debug(`Publishing event ${JSON.stringify(payload)}`);

      for (const sub of subscribers(type)) sub.cb(payload);
    },

    unsubscribe(sub: Subscription) {
      const arr = subscribers(sub.type);
      const index = arr.indexOf(sub);
      if (!index) return;
      arr.splice(index, 1);
    },

    subscribe<Type extends EventTypes>(
      type: Type,
      cb: (payload: EventPayload<Type>) => void
    ) {
      const sub: Subscription = {
        type,
        cb,
      };
      subscribers(type).push(sub);
      return sub;
    },
  };
});
