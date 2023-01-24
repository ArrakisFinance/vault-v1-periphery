/* eslint-disable @typescript-eslint/naming-convention */
export interface Addresses {
  UniswapV3Factory: string;
  ArrakisV1Router: string;
  ArrakisV1Resolver: string;
  ArrakisV1Factory: string;
  WETH: string;
  ArrakisDevMultiSig: string;
  ArrakisV1WethPool: string;
}

export const getAddresses = (network: string): Addresses => {
  switch (network) {
    case "hardhat":
      return {
        UniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        ArrakisV1Router: "0xdD92062aDF9F6EDf528babe7F04804fe86424A74",
        ArrakisV1Resolver: "0x0317650Af6f184344D7368AC8bB0bEbA5EDB214a",
        ArrakisV1Factory: "0xEA1aFf9dbFfD1580F6b81A3ad3589E66652dB7D9",
        WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        ArrakisDevMultiSig: "0xAa2E0c5c85ACb7717e58060AB3c96d2B184EE07C",
        ArrakisV1WethPool: "0xa6c49FD13E50a30C65E6C8480aADA132011D0613",
      };
    case "mainnet":
      return {
        UniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        ArrakisV1Router: "0xdD92062aDF9F6EDf528babe7F04804fe86424A74",
        ArrakisV1Resolver: "0x0317650Af6f184344D7368AC8bB0bEbA5EDB214a",
        ArrakisV1Factory: "0xEA1aFf9dbFfD1580F6b81A3ad3589E66652dB7D9",
        WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        ArrakisDevMultiSig: "0x5108EF86cF493905BcD35A3736e4B46DeCD7de58",
        ArrakisV1WethPool: "0xa6c49FD13E50a30C65E6C8480aADA132011D0613",
      };
    case "goerli":
      return {
        UniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        ArrakisV1Router: "0xB0D04855B253A95cb871bC0F1A73AAb9805FB99c",
        ArrakisV1Resolver: "0x78bfb478192bEFbb0D2ae01354d1362cF54F5D93",
        ArrakisV1Factory: "0x399cFce1F3f5AB74C46d9F0361BE18f87c23FCC3",
        WETH: "0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6",
        ArrakisDevMultiSig: "0x4B5BaD436CcA8df3bD39A095b84991fAc9A226F1",
        ArrakisV1WethPool: "",
      };
    case "polygon":
      return {
        UniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        ArrakisV1Router: "0xc73fb100a995b33f9fA181d420f4C8D74506dF66",
        ArrakisV1Resolver: "0x3638fc820c22b9ecd631943Bc7d5591C0004C7b2",
        ArrakisV1Factory: "0x37265A834e95D11c36527451c7844eF346dC342a",
        WETH: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
        ArrakisDevMultiSig: "0xDEb4C33D5C3E7e32F55a9D6336FE06010E40E3AB",
        ArrakisV1WethPool: "",
      };
    case "optimism":
      return {
        UniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        ArrakisV1Router: "0x9ce88a56d120300061593eF7AD074A1B710094d5",
        ArrakisV1Resolver: "0xd2Bb190dD88e7Af5DF176064Ec42f6dfA8672F40",
        ArrakisV1Factory: "0x2845c6929d621e32B7596520C8a1E5a37e616F09",
        WETH: "0x4200000000000000000000000000000000000006",
        ArrakisDevMultiSig: "0x8636600A864797Aa7ac8807A065C5d8BD9bA3Ccb",
        ArrakisV1WethPool: "",
      };
    case "arbitrum":
      return {
        UniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        ArrakisV1Router: "0x2845c6929d621e32B7596520C8a1E5a37e616F09",
        ArrakisV1Resolver: "0xe03311D30bdeb60511BAe8de135C6524B9576B2e",
        ArrakisV1Factory: "0xd68b055fb444D136e3aC4df023f4C42334F06395",
        WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
        ArrakisDevMultiSig: "0x77BADa8FC2A478f1bc1E1E4980916666187D0dF7",
        ArrakisV1WethPool: "",
      };
    default:
      throw new Error(`No addresses for Network: ${network}`);
  }
};
