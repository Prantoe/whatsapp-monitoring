export type StateName =
  | "booting"
  | "scan_qr"
  | "authenticated"
  | "ready"
  | "disconnected"
  | "auth_failure";

export type State = { state: StateName; me: string | null; error?: string };

export type Direction = "in" | "out";

export type Msg = {
  clientId: string;
  clientLabel: string;
  clientPhone?: string;
  from: string;
  name?: string;
  body: string;
  ts: number;
  direction: Direction;
};

export type BroadcastResult = {
  phone: string
  name?: string
  messageText: string
  timeSendMessage: Date
  timeOfReceiving?: Date | null
  responseTime?: number | null
  threshold: number
}
