import { BigNumber, Contract, ethers } from 'ethers';
import { InfuraProvider } from '@ethersproject/providers';
import { EVMScriptDecoder, abiProviders } from 'evm-script-decoder';
import { EVMScriptCall } from 'evm-script-decoder/lib/types';
import fetch from 'node-fetch';
import { IAddressInfo, ICallInfo, IVotingInfo } from './types';
import { NETWORK, INFURA_PROJECT_ID, CONTRACT_ADDRESS, ETHERSCAN_API_KEY, VOTING_ABI, TOKEN_ABI } from './constants';

async function getDecimals(contract: Contract, provider: InfuraProvider): Promise<number> {
  const tokenAddress = await contract.token();
  const tokenContract = new Contract(tokenAddress, TOKEN_ABI, provider);
  return await tokenContract.decimals();
}

function getDate(timestamp: BigNumber): string {
  const date = new Date(timestamp.toNumber() * 1000);
  return date.toString();
}

async function getAccountType(address: string, provider: InfuraProvider): Promise<string> {
  return (await provider.getCode(address)) === '0x' ? 'EOA' : 'Contract';
}

async function getContractStatus(address: string): Promise<string> {
  const response = await fetch(
    `https://api.etherscan.io/api?module=contract&action=getabi&address=${address}&apikey=${ETHERSCAN_API_KEY}`
  );
  const data = await response.json();

  return data['status'] === '1' ? 'Verified' : 'Not verified';
}

async function getAddressInfo(address: string, provider: InfuraProvider): Promise<IAddressInfo> {
  const accountType = await getAccountType(address, provider);

  return {
    address: address,
    type: accountType,
    status: accountType === 'Contract' ? await getContractStatus(address) : undefined,
  };
}

async function getCallData(call: EVMScriptCall, provider: InfuraProvider): Promise<any[] | undefined> {
  if (!call.abi || !call.abi.inputs || !call.decodedCallData) {
    return call.decodedCallData;
  }

  const data = [];

  for (let i = 0; i < call.abi.inputs.length; ++i) {
    data[i] =
      call.abi.inputs[i].type === 'address'
        ? await getAddressInfo(call.decodedCallData[i], provider)
        : call.decodedCallData[i];
  }

  return data;
}

async function decodeEVMScript(evmScript: string, provider: InfuraProvider): Promise<ICallInfo[]> {
  const decoder = new EVMScriptDecoder(
    new abiProviders.Etherscan({
      network: NETWORK,
      apiKey: ETHERSCAN_API_KEY,
      fetch,
      middlewares: [
        abiProviders.middlewares.ProxyABIMiddleware({
          implMethodNames: [
            ...abiProviders.middlewares.ProxyABIMiddleware.DefaultImplMethodNames,
            '__Proxy_implementation',
          ],
          async loadImplAddress(proxyAddress, abiElement) {
            const contract = new Contract(proxyAddress, [abiElement], provider);
            return contract[abiElement.name]();
          },
        }),
      ],
    })
  );

  const decodedEVMScript = await decoder.decodeEVMScript(evmScript);

  const calls = await Promise.all(
    decodedEVMScript.calls.map(async (call): Promise<ICallInfo> => {
      return {
        addressInfo: await getAddressInfo(call.address, provider),
        method: call.abi?.name,
        inputs: call.abi?.inputs,
        data: await getCallData(call, provider),
        outputs: call.abi?.outputs,
      };
    })
  );

  return calls;
}

async function getVotingInfo(
  contract: Contract,
  votingId: number,
  decimals: number,
  provider: InfuraProvider
): Promise<IVotingInfo> {
  const voting = await contract.getVote(BigNumber.from(votingId));

  return {
    id: votingId,
    status: voting.open ? 'In progress' : voting.executed ? 'Passed' : 'Rejected',
    yesInPercent: +((voting.yea * 100) / voting.votingPower).toFixed(2),
    noInPercent: +((voting.nay * 100) / voting.votingPower).toFixed(2),
    supportRequiredInPercent: (voting.supportRequired * 100) / 10 ** decimals,
    minAcceptQuorumInPercent: (voting.minAcceptQuorum * 100) / 10 ** decimals,
    open: voting.open,
    executed: voting.executed,
    startDate: getDate(voting.startDate),
    snapshotBlock: voting.snapshotBlock.toNumber(),
    supportRequired: voting.supportRequired / 10 ** decimals,
    minAcceptQuorum: voting.minAcceptQuorum / 10 ** decimals,
    yea: +(voting.yea / 10 ** decimals).toFixed(5),
    nay: +(voting.nay / 10 ** decimals).toFixed(5),
    votingPower: voting.votingPower / 10 ** decimals,
    calls: await decodeEVMScript(voting.script, provider),
  };
}

async function getSeveralVotingsInfo(
  contract: Contract,
  votingIds: number[],
  decimals: number,
  provider: InfuraProvider
): Promise<IVotingInfo[]> {
  const votings: IVotingInfo[] = [];

  for (const votingId of votingIds) {
    votings.push(await getVotingInfo(contract, votingId, decimals, provider));
  }

  return votings;
}

async function getAllVotingsInfo(
  contract: Contract,
  decimals: number,
  provider: InfuraProvider
): Promise<IVotingInfo[]> {
  const votings: IVotingInfo[] = [];

  const countOfVotes = await contract.votesLength();

  for (let i = 0; i < countOfVotes.toNumber(); ++i) {
    votings.push(await getVotingInfo(contract, i, decimals, provider));
  }

  return votings;
}

async function main() {
  const provider = new InfuraProvider(NETWORK, INFURA_PROJECT_ID);
  const contract = new Contract(CONTRACT_ADDRESS, VOTING_ABI, provider);

  const decimals = await getDecimals(contract, provider);

  const votingId = 110;
  const votingInfo = await getVotingInfo(contract, votingId, decimals, provider);
  console.dir(votingInfo, { depth: 4 });

  // const votingIds = [107, 108, 109, 110];
  // const votingsInfo = await getSeveralVotingsInfo(contract, votingIds, decimals, provider);
  // console.dir(votingsInfo, { depth: 5 });

  // const votingsInfo = await getAllVotingsInfo(contract, decimals, provider);
  // console.dir(votingsInfo, { depth: 5 });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
