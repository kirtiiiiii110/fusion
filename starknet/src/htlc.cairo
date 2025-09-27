use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
use core::hash::HashStateTrait;
use core::poseidon::PoseidonTrait;
use crate::token::{IFusionTokenDispatcher, IFusionTokenDispatcherTrait};
use core::starknet::storage::{
    Map, StoragePathEntry,
    StoragePointerReadAccess, StoragePointerWriteAccess,
};

#[derive(Drop, Serde, starknet::Store)]
pub struct Timelocks {
    pub withdrawal: u64,
    pub public_withdrawal: u64,
    pub cancellation: u64,
    pub public_cancellation: u64,
    pub deployed_at: u64,
}

#[derive(Drop, Serde, starknet::Store)]
pub struct Escrow {
    pub safety_deposit: u256,
    pub token_amount: u256,
    pub depositor: ContractAddress,
    pub taker: ContractAddress,
    pub hashlock: felt252,
    pub timelocks: Timelocks,
    pub creation_timestamp: u64,
    pub maker: ContractAddress,
    pub token_contract: ContractAddress,
    pub safety_token_contract: ContractAddress,
    pub is_active: bool,
}

#[starknet::interface]
pub trait IHTLC<TContractState> {
    fn create_src_escrow(
        ref self: TContractState,
        depositor: ContractAddress,
        token_contract: ContractAddress,
        safety_token_contract: ContractAddress,
        token_amount: u256,
        safety_deposit: u256,
        hashlock: felt252,
        withdrawal: u64,
        public_withdrawal: u64,
        cancellation: u64,
        public_cancellation: u64,
        salt: felt252,
    ) -> felt252;

    fn create_dst_escrow(
        ref self: TContractState,
        token_contract: ContractAddress,
        safety_token_contract: ContractAddress,
        token_amount: u256,
        safety_deposit: u256,
        taker: ContractAddress,
        hashlock: felt252,
        withdrawal: u64,
        public_withdrawal: u64,
        cancellation: u64,
        public_cancellation: u64,
        salt: felt252,
    ) -> felt252;

    fn withdraw(
        ref self: TContractState,
        escrow_id: felt252,
        secret: felt252,
    );

    fn cancel(
        ref self: TContractState,
        escrow_id: felt252,
    );

    fn get_escrow_info(self: @TContractState, escrow_id: felt252) -> Escrow;

    fn is_withdrawal_allowed(self: @TContractState, escrow_id: felt252, caller: ContractAddress) -> bool;

    fn is_cancellation_allowed(self: @TContractState, escrow_id: felt252, caller: ContractAddress) -> bool;
}

#[starknet::contract]
pub mod HTLC {
    use super::{Timelocks, Escrow, ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use core::hash::HashStateTrait;
    use core::poseidon::PoseidonTrait;
    use crate::token::{IFusionTokenDispatcher, IFusionTokenDispatcherTrait};
    use core::starknet::storage::{
        Map, StoragePathEntry,
        StoragePointerReadAccess, StoragePointerWriteAccess,
    };

    const E_INVALID_SIGNER: felt252 = 'Invalid signer';
    const E_INVALID_TIMELOCK: felt252 = 'Invalid timelock';
    const E_INVALID_SECRET: felt252 = 'Invalid secret';
    const E_ESCROW_NOT_FOUND: felt252 = 'Escrow not found';
    const E_ESCROW_NOT_ACTIVE: felt252 = 'Escrow not active';

    #[storage]
    struct Storage {
        owner: ContractAddress,
        escrows: Map<felt252, Escrow>,
        nonce: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        EscrowCreated: EscrowCreated,
        EscrowWithdrawn: EscrowWithdrawn,
        EscrowCancelled: EscrowCancelled,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EscrowCreated {
        pub escrow_id: felt252,
        pub maker: ContractAddress,
        pub taker: ContractAddress,
        pub token_amount: u256,
        pub safety_deposit: u256,
        pub hashlock: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EscrowWithdrawn {
        pub escrow_id: felt252,
        pub taker: ContractAddress,
        pub resolver: ContractAddress,
        pub secret: felt252,
        pub token_amount: u256,
        pub safety_deposit: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EscrowCancelled {
        pub escrow_id: felt252,
        pub maker: ContractAddress,
        pub canceller: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.owner.write(owner);
        self.nonce.write(0);
    }

    #[abi(embed_v0)]
    impl HTLCImpl of super::IHTLC<ContractState> {
        fn create_src_escrow(
            ref self: ContractState,
            depositor: ContractAddress,
            token_contract: ContractAddress,
            safety_token_contract: ContractAddress,
            token_amount: u256,
            safety_deposit: u256,
            hashlock: felt252,
            withdrawal: u64,
            public_withdrawal: u64,
            cancellation: u64,
            public_cancellation: u64,
            salt: felt252,
        ) -> felt252 {
            let resolver = get_caller_address();
            
            let escrow_id = self._compute_escrow_seed(
                token_contract,
                safety_token_contract,
                token_amount,
                safety_deposit,
                depositor,
                resolver,
                hashlock,
                withdrawal,
                public_withdrawal,
                cancellation,
                public_cancellation,
                salt
            );

            let timelocks = Timelocks {
                withdrawal,
                public_withdrawal,
                cancellation,
                public_cancellation,
                deployed_at: get_block_timestamp()
            };

            let escrow = Escrow {
                safety_deposit,
                token_amount,
                depositor,
                taker: resolver,
                hashlock,
                timelocks,
                creation_timestamp: get_block_timestamp(),
                maker: resolver,
                token_contract,
                safety_token_contract,
                is_active: true,
            };

            let token = IFusionTokenDispatcher { contract_address: token_contract };
            token.transfer_from(depositor, get_contract_address(), token_amount);
            
            let safety_token = IFusionTokenDispatcher { contract_address: safety_token_contract };
            safety_token.transfer_from(resolver, get_contract_address(), safety_deposit);

            self.escrows.entry(escrow_id).write(escrow);

            self.emit(EscrowCreated {
                escrow_id,
                maker: depositor,
                taker: resolver,
                token_amount,
                safety_deposit,
                hashlock,
            });

            escrow_id
        }

        fn create_dst_escrow(
            ref self: ContractState,
            token_contract: ContractAddress,
            safety_token_contract: ContractAddress,
            token_amount: u256,
            safety_deposit: u256,
            taker: ContractAddress,
            hashlock: felt252,
            withdrawal: u64,
            public_withdrawal: u64,
            cancellation: u64,
            public_cancellation: u64,
            salt: felt252,
        ) -> felt252 {
            let maker = get_caller_address();
            
            let escrow_id = self._compute_escrow_seed(
                token_contract,
                safety_token_contract,
                token_amount,
                safety_deposit,
                maker,
                taker,
                hashlock,
                withdrawal,
                public_withdrawal,
                cancellation,
                public_cancellation,
                salt
            );

            let timelocks = Timelocks {
                withdrawal,
                public_withdrawal,
                cancellation,
                public_cancellation,
                deployed_at: get_block_timestamp()
            };

            let escrow = Escrow {
                safety_deposit,
                token_amount,
                depositor: maker,
                taker,
                hashlock,
                timelocks,
                creation_timestamp: get_block_timestamp(),
                maker,
                token_contract,
                safety_token_contract,
                is_active: true,
            };

            let token = IFusionTokenDispatcher { contract_address: token_contract };
            token.transfer_from(maker, get_contract_address(), token_amount);
            
            let safety_token = IFusionTokenDispatcher { contract_address: safety_token_contract };
            safety_token.transfer_from(maker, get_contract_address(), safety_deposit);

            self.escrows.entry(escrow_id).write(escrow);

            self.emit(EscrowCreated {
                escrow_id,
                maker,
                taker,
                token_amount,
                safety_deposit,
                hashlock,
            });

            escrow_id
        }

        fn withdraw(
            ref self: ContractState,
            escrow_id: felt252,
            secret: felt252,
        ) {
            let mut escrow = self.escrows.entry(escrow_id).read();
            assert(escrow.is_active, E_ESCROW_NOT_ACTIVE);
            
            let resolver = get_caller_address();
            
            let hash_secret = PoseidonTrait::new().update(secret).finalize();
            assert(hash_secret == escrow.hashlock, E_INVALID_SECRET);
            
            let current_time = get_block_timestamp();
            let elapsed_time = current_time - escrow.creation_timestamp;
            
            if elapsed_time >= escrow.timelocks.public_withdrawal {
                assert(elapsed_time < escrow.timelocks.cancellation, E_INVALID_TIMELOCK);
            } else {
                assert(elapsed_time >= escrow.timelocks.withdrawal, E_INVALID_TIMELOCK);
                assert(
                    resolver == escrow.taker || resolver == escrow.depositor,
                    E_INVALID_SIGNER
                );
            }

            let safety_token = IFusionTokenDispatcher { contract_address: escrow.safety_token_contract };
            safety_token.transfer(resolver, escrow.safety_deposit);

            let token = IFusionTokenDispatcher { contract_address: escrow.token_contract };
            token.transfer(escrow.taker, escrow.token_amount);

            self.emit(EscrowWithdrawn {
                escrow_id,
                taker: escrow.taker,
                resolver,
                secret,
                token_amount: escrow.token_amount,
                safety_deposit: escrow.safety_deposit,
            });

            escrow.is_active = false;
            self.escrows.entry(escrow_id).write(escrow);
        }

        fn cancel(
            ref self: ContractState,
            escrow_id: felt252,
        ) {
            let mut escrow = self.escrows.entry(escrow_id).read();
            assert(escrow.is_active, E_ESCROW_NOT_ACTIVE);
            
            let canceller = get_caller_address();
            
            let current_time = get_block_timestamp();
            let elapsed_time = current_time - escrow.creation_timestamp;
            
            if elapsed_time < escrow.timelocks.public_cancellation {
                assert(elapsed_time >= escrow.timelocks.cancellation, E_INVALID_TIMELOCK);
                assert(canceller == escrow.depositor, E_INVALID_SIGNER);
            }

            let safety_token = IFusionTokenDispatcher { contract_address: escrow.safety_token_contract };
            safety_token.transfer(canceller, escrow.safety_deposit);

            let token = IFusionTokenDispatcher { contract_address: escrow.token_contract };
            token.transfer(escrow.depositor, escrow.token_amount);

            self.emit(EscrowCancelled {
                escrow_id,
                maker: escrow.depositor,
                canceller,
            });

            escrow.is_active = false;
            self.escrows.entry(escrow_id).write(escrow);
        }

        fn get_escrow_info(self: @ContractState, escrow_id: felt252) -> Escrow {
            let escrow = self.escrows.entry(escrow_id).read();
            assert(escrow.is_active, E_ESCROW_NOT_FOUND);
            escrow
        }

        fn is_withdrawal_allowed(self: @ContractState, escrow_id: felt252, caller: ContractAddress) -> bool {
            let escrow = self.escrows.entry(escrow_id).read();
            if !escrow.is_active {
                return false;
            }
            
            let current_time = get_block_timestamp();
            let elapsed_time = current_time - escrow.creation_timestamp;
            
            if elapsed_time >= escrow.timelocks.public_withdrawal {
                elapsed_time < escrow.timelocks.cancellation
            } else if elapsed_time >= escrow.timelocks.withdrawal {
                caller == escrow.taker || caller == escrow.depositor
            } else {
                false
            }
        }

        fn is_cancellation_allowed(self: @ContractState, escrow_id: felt252, caller: ContractAddress) -> bool {
            let escrow = self.escrows.entry(escrow_id).read();
            if !escrow.is_active {
                return false;
            }
            
            let current_time = get_block_timestamp();
            let elapsed_time = current_time - escrow.creation_timestamp;
            
            if elapsed_time >= escrow.timelocks.public_cancellation {
                true
            } else if elapsed_time >= escrow.timelocks.cancellation {
                caller == escrow.depositor
            } else {
                false
            }
        }
    }

    #[generate_trait]
    pub(crate) impl InternalHTLCFunctions of InternalHTLCFunctionsTrait {
        fn _compute_escrow_seed(
            ref self: ContractState,
            token_contract: ContractAddress,
            safety_token_contract: ContractAddress,
            token_amount: u256,
            safety_deposit: u256,
            depositor: ContractAddress,
            taker: ContractAddress,
            hashlock: felt252,
            withdrawal: u64,
            public_withdrawal: u64,
            cancellation: u64,
            public_cancellation: u64,
            salt: felt252,
        ) -> felt252 {
            let current_nonce = self.nonce.read();
            self.nonce.write(current_nonce + 1);
            
            PoseidonTrait::new()
                .update(token_contract.into())
                .update(safety_token_contract.into())
                .update(token_amount.low.into())
                .update(token_amount.high.into())
                .update(safety_deposit.low.into())
                .update(safety_deposit.high.into())
                .update(depositor.into())
                .update(taker.into())
                .update(hashlock)
                .update(withdrawal.into())
                .update(public_withdrawal.into())
                .update(cancellation.into())
                .update(public_cancellation.into())
                .update(salt)
                .update(current_nonce.low.into())
                .finalize()
        }
    }
}