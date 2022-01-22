export interface VoteInformation {
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
}
