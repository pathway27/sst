import { IoTClient, DescribeEndpointCommand } from "@aws-sdk/client-iot";
import { Context } from "@serverless-stack/node/context/context.js";
import { useAWSClient, useAWSCredentials } from "../credentials/index.js";
import { VisibleError } from "../error/index.js";

export const useIOTEndpoint = Context.memo(async () => {
  const iot = await useAWSClient(IoTClient);
  const response = await iot.send(
    new DescribeEndpointCommand({
      endpointType: "iot:Data-ATS",
    })
  );

  if (!response.endpointAddress)
    throw new VisibleError("IoT Endpoint address not found");

  return response.endpointAddress;
});

import iot from "aws-iot-device-sdk";
import { EventPayload, Events, EventTypes, useBus } from "../bus/index.js";
import { useConfig } from "../config/index.js";
import { Logger } from "../logger/index.js";

interface Fragment {
  id: string;
  index: number;
  count: number;
  data: string;
}

export const useIOT = Context.memo(async () => {
  const bus = useBus();

  const endpoint = await useIOTEndpoint();
  const creds = await useAWSCredentials();
  const config = await useConfig();
  const device = new iot.device({
    protocol: "wss",
    host: endpoint,
    accessKeyId: creds.accessKeyId,
    secretKey: creds.secretAccessKey,
    sessionToken: creds.sessionToken,
  });
  const PREFIX = `/sst/${config.name}/${config.stage}`;
  device.subscribe(`${PREFIX}/events`);

  const fragments = new Map<string, Map<number, Fragment>>();

  device.on("message", (_topic, buffer: Buffer) => {
    const fragment = JSON.parse(buffer.toString()) as Fragment;
    let pending = fragments.get(fragment.id);
    if (!pending) {
      pending = new Map();
      fragments.set(fragment.id, pending);
    }
    pending.set(fragment.index, fragment);

    if (pending.size === fragment.count) {
      const data = [...pending.values()]
        .sort((a, b) => a.index - b.index)
        .map((item) => item.data)
        .join("");
      fragments.delete(fragment.id);
      const evt = JSON.parse(data) as EventPayload;
      Logger.debug("Got from IOT", evt);
      if (evt.sourceID === bus.sourceID) return;
      bus.publish(evt.type, evt.properties);
    }
  });

  return {
    prefix: PREFIX,
    publish<Type extends EventTypes>(
      topic: string,
      type: Type,
      properties: Events[Type]
    ) {
      const payload: EventPayload = {
        type,
        properties,
        sourceID: bus.sourceID,
      };
      for (const fragment of encode(payload)) {
        device.publish(topic, JSON.stringify(fragment), {
          qos: 1,
        });
      }
    },
  };
});

function encode(input: any) {
  const json = JSON.stringify(input);
  const parts = json.match(/.{1,100000}/g);
  if (!parts) return [];
  const id = Math.random().toString();
  return parts.map((part, index) => ({
    id,
    index,
    count: parts?.length,
    data: part,
  }));
}
