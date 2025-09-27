# Fusion

This project demonstrates a **cross-chain swapping framework** connecting **Ethereum Sepolia (EVM)**, **Monad**, and **Starknet**



## Overview

* **Sepolia (EVM)**

  * Uses the canonical **1inch Limit Order Protocol** for creating and settling orders.
* **Monad**

  * Hosts a **custom LOP deployment** plus dedicated **escrow contracts** to manage swap finality.
* **Starknet**

  * Relies on **HTLC-style escrow contracts** to synchronize atomic swaps with EVM/Monad chains.


## Contracts

### **Sepolia (EVM)**
* **LOP:** [`0x111111125421cA6dc452d289314280a0f8842A65`](https://sepolia.etherscan.io/address/0x111111125421cA6dc452d289314280a0f8842A65)
* **Escrow Factory:** [`0x09092Cde983b41F6C5cB945c02bb102ABEFfA6CB`](https://sepolia.etherscan.io/address/0x09092Cde983b41F6C5cB945c02bb102ABEFfA6CB)
* **Resolver:** [`0xB4Dd500EC6725494872550649b75C70EA4b0D093`](https://sepolia.etherscan.io/address/0xB4Dd500EC6725494872550649b75C70EA4b0D093)
* **Token:** [`0x7b79995e5f793a07bc00c21412e50ecae098e7f9`](https://sepolia.etherscan.io/address/0x7b79995e5f793a07bc00c21412e50ecae098e7f9)

### **Monad**
* **LOP:** [`0x09092Cde983b41F6C5cB945c02bb102ABEFfA6CB`](https://testnet.monadexplorer.com/address/0x09092Cde983b41F6C5cB945c02bb102ABEFfA6CB)
* **Escrow Factory:** [`0xB4Dd500EC6725494872550649b75C70EA4b0D093`](https://testnet.monadexplorer.com/address/0xB4Dd500EC6725494872550649b75C70EA4b0D093)
* **Resolver Contract:** [`0x83E73B06DFcf69537469877D827Ddb1fB0C99545`](https://testnet.monadexplorer.com/address/0x83E73B06DFcf69537469877D827Ddb1fB0C99545)
* **Token:** [`0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701`](https://testnet.monadexplorer.com/address/0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701)

### **Starknet**
* **Factory:** [`0x05fc3c3dc566451a11667bf278d7935338191072108abf5e9e611cf04e122a23`](https://sepolia.starkscan.co/contract/0x05fc3c3dc566451a11667bf278d7935338191072108abf5e9e611cf04e122a23)
* **Token:** [`0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`](https://sepolia.starkscan.co/contract/0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d)
