import fetch from "node-fetch";

type SwapAmountApiResponseType = {
  add: {
    amount0Min: string;
    amount1Min: string;
  };
  swap: {
    amountIn: string;
    amountOut: string;
    minAmountOut: string;
    zeroForOne: boolean;
    to: string;
    data: string;
  };
};

const getSwapAmount = async (
  amount0Max: string,
  amount1Max: string,
  vault: string,
  networkId: string,
  arrakisRouter: string
): Promise<SwapAmountApiResponseType> => {
  try {
    const apiRequest = `${process.env.SWAP_AMOUNT_API_URL}/?amount0Max=${amount0Max}&amount1Max=${amount1Max}&vault=${vault}&network=${networkId}&arrakisRouter=${arrakisRouter}`;
    const apiResponse = (await (await fetch(apiRequest)).json()) as unknown as {
      add: {
        amount0Min: string;
        amount1Min: string;
      };
      swap: {
        amountIn: string;
        amountOut: string;
        minAmountOut: string;
        zeroForOne: boolean;
        to: string;
        data: string;
      };
    };

    return apiResponse;
  } catch (error) {
    console.log("Error when getting swap amount: ", error);
    throw new Error(`Error when getting swap amount`);
  }
};

export { getSwapAmount };
