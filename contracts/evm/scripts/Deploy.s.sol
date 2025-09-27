// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;
import 'forge-std/console.sol';
import 'forge-std/Script.sol';

import {Resolver, IOrderMixin} from '../contracts/src/Resolver.sol';
import 'cross-chain-swap/EscrowFactory.sol';
import {IERC20} from 'openzeppelin-contracts/contracts/token/ERC20/IERC20.sol';

contract Deploy is Script {
    address limitOrderProtocol = vm.envAddress('LIMIT_ORDER_PROTOCOL');
    address resolver = vm.envAddress('RESOLVER');

    function run() external {
        vm.startBroadcast();
        EscrowFactory escrowFactory = new EscrowFactory(
            limitOrderProtocol,
            IERC20(0x000000000000000000000000000000000000dEaD),
            IERC20(0x000000000000000000000000000000000000dEaD),
            msg.sender,
            uint32(1800),
            uint32(1800)
        );
        Resolver resolverContract = new Resolver(escrowFactory, IOrderMixin(limitOrderProtocol), resolver);
        vm.stopBroadcast();

        console.log(address(escrowFactory));
        console.log(address(resolverContract));
    }
}
