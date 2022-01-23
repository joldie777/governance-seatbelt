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
  yesInPercent: number;
  noInPercent: number;
  supportRequiredInPercent: number;
  minAcceptQuorumInPercent: number;
  open: boolean;
  executed: boolean;
  startDate: string;
  snapshotBlock: number;
  supportRequired: number;
  minAcceptQuorum: number;
  yea: number;
  nay: number;
  votingPower: number;
  calls: ICallInfo[];
}
