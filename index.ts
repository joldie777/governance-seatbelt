import { ethers } from 'ethers';
import { EVMScriptParser, EVMScriptDecoder, abiProviders } from 'evm-script-decoder';
import fetch from 'node-fetch';
import { VoteInformation } from './types';
import {
  NETWORK,
  INFURA_PROJECT_ID,
  CONTRACT_ADDRESS,
  ETHERSCAN_API_KEY,
  CONTRACT_ABI,
  VOTING_ABI,
  TOKEN_ABI,
} from './constants';

async function getDecimals(contract: ethers.Contract, provider: ethers.providers.InfuraProvider): Promise<number> {
  const tokenAddress = await contract.token();
  const tokenContract = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);
  return await tokenContract.decimals();
}

function getDate(timestamp: ethers.BigNumber): string {
  const date = new Date(timestamp.toNumber() * 1000);
  return date.toString();
}

async function getVoteInfo(contract: ethers.Contract, voteId: number, decimals: number): Promise<VoteInformation> {
  const vote = await contract.getVote(ethers.BigNumber.from(voteId));

  return {
    id: voteId,
    status: vote.open ? 'In progress' : vote.executed ? 'Passed' : 'Rejected',
    yesInPercent: +((vote.yea * 100) / vote.votingPower).toFixed(2),
    noInPercent: +((vote.nay * 100) / vote.votingPower).toFixed(2),
    supportRequiredInPercent: (vote.supportRequired * 100) / 10 ** decimals,
    minAcceptQuorumInPercent: (vote.minAcceptQuorum * 100) / 10 ** decimals,
    open: vote.open,
    executed: vote.executed,
    startDate: getDate(vote.startDate),
    snapshotBlock: vote.snapshotBlock.toNumber(),
    supportRequired: vote.supportRequired / 10 ** decimals,
    minAcceptQuorum: vote.minAcceptQuorum / 10 ** decimals,
    yea: +(vote.yea / 10 ** decimals).toFixed(5),
    nay: +(vote.nay / 10 ** decimals).toFixed(5),
    votingPower: vote.votingPower / 10 ** decimals,
  };
}

    // new abiProviders.Local({
    //   '0x2e59A20f205bB85a89C53f1936454680651E618e': CONTRACT_ABI,
    // }),
    // new abiProviders.Etherscan({
    //   network: NETWORK,
    //   apiKey: ETHERSCAN_API_KEY,
    //   fetch,
    // })
async function decodeEVMScript(evmScript: string, provider: ethers.providers.InfuraProvider): Promise<void> {
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
            const contract = new ethers.Contract(proxyAddress, [abiElement], provider);
            return contract[abiElement.name]();
          },
        }),
      ],
    })
  );

  const decodedEVMScript = await decoder.decodeEVMScript(evmScript);

  console.log(decodedEVMScript);
}

async function main() {
  const provider = new ethers.providers.InfuraProvider(NETWORK, INFURA_PROJECT_ID);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, VOTING_ABI, provider);

  const decimals = await getDecimals(contract, provider);
  // const countOfVotes = await contract.votesLength();

  // for (let i = 0; i < countOfVotes.toNumber(); ++i) {
  //   await getVoteInfo(contract, i, decimals);
  // }

  // const voteInfo = await getVoteInfo(contract, 108, decimals);
  // console.log(voteInfo);

  const vote = await contract.getVote(3);

  //console.log(EVMScriptParser.parse(vote.script));

  await decodeEVMScript(vote.script, provider);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
