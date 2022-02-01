require('dotenv').config();
import { BigNumber, Contract } from 'ethers';
import { InfuraProvider } from '@ethersproject/providers';
import { EVMScriptDecoder, abiProviders } from 'evm-script-decoder';
import { EVMScriptCall } from 'evm-script-decoder/lib/types';
import * as readline from 'readline';
import fetch from 'node-fetch';
import { IAddressInfo, ICallInfo, IVotingInfo } from './types';
import { NETWORK, INFURA_PROJECT_ID, CONTRACT_ADDRESS, ETHERSCAN_API_KEY } from './constants';

async function getAbiByAddress(address: string): Promise<string> {
  let response = await fetch(
    `https://api.etherscan.io/api?module=contract&action=getabi&address=${address}&apikey=${ETHERSCAN_API_KEY}`
  );
  let data = await response.json();

  if (data['message'] === 'NOTOK') {
    throw new Error(`Etherscan - ${data['result']}`);
  }

  return data['result'];
}

async function getVotingABI(provider: InfuraProvider): Promise<string> {
  console.log('Getting ABI for contract...');

  let abi = await getAbiByAddress(CONTRACT_ADDRESS);
  const contract = new Contract(CONTRACT_ADDRESS, abi, provider);
  
  let votingContract: string;

  try {
    votingContract = await contract.implementation();
  } catch (error) {
    const jsonError = JSON.parse(JSON.stringify(error));
    throw new Error(`Infura - ${jsonError['error']['body']}`);
  }

  abi = await getAbiByAddress(votingContract);

  console.log('Done!');

  return abi;
}

function getDate(timestamp: BigNumber): string {
  const date = new Date(timestamp.toNumber() * 1000);
  return date.toString();
}

async function getAccountType(address: string, provider: InfuraProvider): Promise<string> {
  return (await provider.getCode(address)) === '0x' ? 'EOA' : 'Contract';
}

async function getContractStatus(address: string): Promise<string> {
  const request = `https://api.etherscan.io/api?module=contract&action=getabi&address=${address}&apikey=${ETHERSCAN_API_KEY}`;

  let response = await fetch(request);
  let data = await response.json();

  while (data['result'] === 'Max rate limit reached') {
    response = await fetch(request);
    data = await response.json();
  }

  if (data['message'] === 'NOTOK') {
    throw new Error(`Etherscan - ${data['result']}`);
  }

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
    data.push(
      call.abi.inputs[i].type === 'address'
        ? await getAddressInfo(call.decodedCallData[i], provider)
        : call.decodedCallData[i]
    );
  }

  return data;
}

async function getEVMScriptCallsInfo(evmScript: string, provider: InfuraProvider): Promise<ICallInfo[]> {
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

  console.log('Decoding voting script...');

  const decodedEVMScript = await decoder.decodeEVMScript(evmScript);

  console.log('Done!\nGetting calls data...');

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

  console.log('Done!');

  return calls;
}

async function getVotingInfo(
  contract: Contract,
  votingId: number,
  PCT_BASE: any,
  provider: InfuraProvider
): Promise<IVotingInfo> {
  console.log(`\nGetting data for voting ${votingId}...`);

  const voting = await contract.getVote(BigNumber.from(votingId));

  console.log('Done!');

  const callsInfo = await getEVMScriptCallsInfo(voting.script, provider);
  const votesCount = voting.yea.add(voting.nay);
  const yesInPercent = votesCount.isZero() ? 0 : voting.yea.mul(100) / votesCount;
  const noInPercent = votesCount.isZero() ? 0 : voting.nay.mul(100) / votesCount;
  const supportRequiredInPercent = voting.supportRequired.mul(100) / PCT_BASE;
  const minAcceptQuorumInPercent = voting.minAcceptQuorum.mul(100) / PCT_BASE;

  var result = {
    id: votingId,
    status: voting.open
      ? 'In progress'
      : voting.executed
      ? 'Passed (enacted)'
      : callsInfo.length === 0 && yesInPercent > supportRequiredInPercent
      ? 'Passed'
      : 'Rejected',
    open: voting.open,
    executed: voting.executed,
    startDate: getDate(voting.startDate),
    snapshotBlock: voting.snapshotBlock.toNumber(),
    supportRequired: `${supportRequiredInPercent}%`,
    minAcceptQuorum: `${minAcceptQuorumInPercent}%`,
    yea: `${+(voting.yea / PCT_BASE).toFixed(5)} (${+yesInPercent.toFixed(2)}%)`,
    nay: `${+(voting.nay / PCT_BASE).toFixed(5)} (${+noInPercent.toFixed(2)}%)`,
    votingPower: (voting.votingPower / PCT_BASE).toString(),
    approval: `${+(voting.yea.mul(100) / voting.votingPower).toFixed(2)}%`,
    calls: callsInfo,
  };

  console.log(`Report for voting ${votingId} has been successfully generated!`);

  return result;
}

async function getAllVotingsInfo(
  contract: Contract,
  countOfVotings: number,
  PCT_BASE: number,
  provider: InfuraProvider
): Promise<IVotingInfo[]> {
  const votings: IVotingInfo[] = [];

  for (let i = 0; i < countOfVotings; ++i) {
    votings.push(await getVotingInfo(contract, i, PCT_BASE, provider));
  }

  return votings;
}

async function main(): Promise<void> {
  const provider = new InfuraProvider(NETWORK, INFURA_PROJECT_ID);
  const votingABI = await getVotingABI(provider);
  const contract = new Contract(CONTRACT_ADDRESS, votingABI, provider);
  const PCT_BASE = await contract.PCT_BASE();
  const countOfVotings: number = await contract.votesLength();

  const startPrompt = `\nInput votingId (from 0 to ${
    countOfVotings - 1
  }) or "all" to generate report for all votings: `;
  const finalPrompt = '\nInput "r" to restart or "q" to quit the program: ';

  let isWaiting = false;

  return new Promise((resolve) => {
    const rl = readline.createInterface(process.stdin, process.stdout);

    rl.setPrompt(startPrompt);
    rl.prompt();

    rl.on('line', async (input) => {
      if (input === 'q' || input === 'quit') {
        rl.close();
        return resolve();
      }

      if (!isWaiting) {
        if (input === 'all') {
          const votingsInfo = await getAllVotingsInfo(contract, countOfVotings, PCT_BASE, provider);

          console.log('\nResult:');
          console.dir(votingsInfo, { depth: 5 });

          isWaiting = true;
          rl.setPrompt(finalPrompt);
        } else {
          const votingId = parseInt(input);

          if (isNaN(votingId)) {
            console.warn('Incorrect input. Try again...');
          } else if (votingId < 0 || votingId >= countOfVotings) {
            console.warn('The number is out of range. Try again...');
          } else {
            const votingInfo = await getVotingInfo(contract, votingId, PCT_BASE, provider);

            console.log('\nResult:');
            console.dir(votingInfo, { depth: 4 });

            isWaiting = true;
            rl.setPrompt(finalPrompt);
          }
        }
      } else {
        if (input === 'r' || input === 'restart') {
          isWaiting = false;
          rl.setPrompt(startPrompt);
        } else {
          console.warn(`Unknown command: "${input}"`);
        }
      }

      rl.prompt();
    }).on('close', () => {
      console.log('The program has been stopped.\n');
    });
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
