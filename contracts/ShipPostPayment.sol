// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract ShipPostPayment is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public agentWallet;
    address public treasury;

    uint256 public threadCounter;

    mapping(address => bool) public allowedTokens;
    // Threads already refunded — on-chain idempotency so a double refund is
    // impossible regardless of any off-chain bookkeeping.
    mapping(uint256 => bool) public refunded;

    // Splits in basis points (must sum to 10000). The reserve share is NOT
    // pushed out on payment: it stays in this contract and funds refunds.
    uint256 public agentBp = 5000;    // 50%
    uint256 public treasuryBp = 4000; // 40%
    uint256 public reserveBp = 1000;  // 10% — retained in-contract

    /// @notice Thread price in whole US cents. Settable so a price change never
    /// requires a redeploy — the previous version hardcoded $0.05 in
    /// requiredAmount, which made every repricing a migration.
    uint256 public priceUsdCents = 10;

    event ThreadRequested(
        address indexed user,
        uint256 indexed threadId,
        uint8 mode,
        address token,
        uint256 amount
    );
    event TokenAllowed(address indexed token, bool allowed);
    event FeeSplitUpdated(uint256 agentBp, uint256 treasuryBp, uint256 reserveBp);
    event AgentWalletUpdated(address indexed previous, address indexed current);
    event TreasuryUpdated(address indexed previous, address indexed current);
    event Refunded(uint256 indexed threadId, address indexed token, address indexed to, uint256 amount);
    event ReserveWithdrawn(address indexed token, address indexed to, uint256 amount);
    event PriceUpdated(uint256 previous, uint256 current);

    /// @param _startThreadId initial value for threadCounter. On a redeploy this
    /// MUST be set above the previous contract's highest threadId — the backend
    /// keys its replay guard on (chainId, threadId) and colliding IDs would
    /// reject fresh payments as duplicates.
    constructor(
        address _agentWallet,
        address _treasury,
        uint256 _startThreadId
    ) Ownable(msg.sender) {
        require(_agentWallet != address(0) && _treasury != address(0), "ZERO_ADDR");
        agentWallet = _agentWallet;
        treasury = _treasury;
        threadCounter = _startThreadId;
    }

    function setAllowedToken(address token, bool allowed) external onlyOwner {
        allowedTokens[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function updateFeeSplit(uint256 _agentBp, uint256 _treasuryBp, uint256 _reserveBp) external onlyOwner {
        require(_agentBp + _treasuryBp + _reserveBp == 10000, "BP_SUM");
        agentBp = _agentBp;
        treasuryBp = _treasuryBp;
        reserveBp = _reserveBp;
        emit FeeSplitUpdated(_agentBp, _treasuryBp, _reserveBp);
    }

    /// @notice Redirect the agent split.
    function setAgentWallet(address _agentWallet) external onlyOwner {
        require(_agentWallet != address(0), "ZERO_ADDR");
        emit AgentWalletUpdated(agentWallet, _agentWallet);
        agentWallet = _agentWallet;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "ZERO_ADDR");
        emit TreasuryUpdated(treasury, _treasury);
        treasury = _treasury;
    }

    /// @notice Reprice a thread. Users are protected from a price change landing
    /// between their read and their transaction by payForThread's maxAmount.
    function setPrice(uint256 newPriceUsdCents) external onlyOwner {
        require(newPriceUsdCents > 0, "ZERO_PRICE");
        emit PriceUpdated(priceUsdCents, newPriceUsdCents);
        priceUsdCents = newPriceUsdCents;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Compute the required amount for a thread in this token, at the
    /// current price.
    function requiredAmount(address token) public view returns (uint256) {
        uint8 d = IERC20Metadata(token).decimals();
        require(d >= 2, "BAD_DECIMALS");
        return priceUsdCents * (10 ** (d - 2));
    }

    /// @param maxAmount the most the caller consents to pay, in token base
    /// units. The price is settable, so without this ceiling an owner could
    /// reprice in the gap between a user reading the price and their
    /// transaction landing, and the user would pay the new price silently.
    function payForThread(address token, uint8 mode, uint256 maxAmount)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 threadId)
    {
        require(allowedTokens[token], "TOKEN_NOT_ALLOWED");
        uint256 amount = requiredAmount(token);
        require(amount <= maxAmount, "PRICE_EXCEEDS_MAX");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        uint256 agentShare = (amount * agentBp) / 10000;
        uint256 treasuryShare = (amount * treasuryBp) / 10000;
        // reserveShare = amount - agentShare - treasuryShare stays in this
        // contract as the refund pool. Wei dust from the split rounds into it.
        IERC20(token).safeTransfer(agentWallet, agentShare);
        IERC20(token).safeTransfer(treasury, treasuryShare);

        threadCounter++;
        threadId = threadCounter;
        emit ThreadRequested(msg.sender, threadId, mode, token, amount);
    }

    /// @notice Refund a thread from the accumulated reserve. Paid from this
    /// contract's balance and hard-capped by it, so refunds can never exceed the
    /// reserve. Idempotent per threadId. Deliberately callable while paused — the
    /// owner must always be able to make a user whole (mirrors the kill-switch
    /// carve-out on AgentWallet.emergencyWithdraw).
    function refund(uint256 threadId, address token, address to, uint256 amount)
        external
        onlyOwner
        nonReentrant
    {
        require(!refunded[threadId], "ALREADY_REFUNDED");
        require(to != address(0), "ZERO_ADDR");
        require(IERC20(token).balanceOf(address(this)) >= amount, "RESERVE_INSUFFICIENT");

        refunded[threadId] = true; // effects before interaction
        IERC20(token).safeTransfer(to, amount);
        emit Refunded(threadId, token, to, amount);
    }

    /// @notice Reclaim excess reserve (e.g. sweep to treasury). Owner-gated and
    /// capped by the held balance.
    function withdrawReserve(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "ZERO_ADDR");
        require(IERC20(token).balanceOf(address(this)) >= amount, "RESERVE_INSUFFICIENT");
        IERC20(token).safeTransfer(to, amount);
        emit ReserveWithdrawn(token, to, amount);
    }
}
