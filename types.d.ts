export interface IAddressInfo {
  address: string;
  type: string;
  status?: string;
}

export interface ICallInfo {
  addressInfo: IAddressInfo;
  method?: string;
  inputs?: any[];
  data?: any[];
  outputs?: any[];
}

export interface IVotingInfo {
  id: number;
  status: string;
  open: boolean;
  executed: boolean;
  startDate: string;
  snapshotBlock: number;
  supportRequired: string;
  minAcceptQuorum: string;
  yea: string;
  nay: string;
  votingPower: string;
  approval: string;
  calls: ICallInfo[];
}
