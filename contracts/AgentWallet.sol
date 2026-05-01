// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title AgentWallet — ERC-8004-style wallet for autonomous agents.
/// Holds stablecoins; spend cap per token per 24h UTC window.
/// `Pausable` is the kill-switch for compromised orchestrator keys —
/// pausing freezes `executeX402Call` and `approveFacilitator` so funds
/// can be recovered via `emergencyWithdraw` (which deliberately remains
/// callable while paused so the owner can drain).
contract AgentWallet is Ownable, ReentrancyGuard, Pausable {
    mapping(address => uint256) public dailySpendCap;

    mapping(uint256 => mapping(address => uint256)) public spentOnDay;

    address public x402Facilitator;

    event X402PaymentMade(
        address indexed service,
        address indexed token,
        uint256 amount,
        uint256 threadId
    );
    event DailyCapUpdated(address indexed token, uint256 cap);
    event FacilitatorUpdated(address indexed facilitator);
    event EmergencyWithdraw(address indexed token, uint256 amount, address indexed to);

    constructor() Ownable(msg.sender) {}

    function setDailySpendCap(address token, uint256 cap) external onlyOwner {
        dailySpendCap[token] = cap;
        emit DailyCapUpdated(token, cap);
    }

    function setFacilitator(address facilitator) external onlyOwner {
        x402Facilitator = facilitator;
        emit FacilitatorUpdated(facilitator);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function currentDay() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /// @notice Pay an x402 service. Only the owner (orchestrator) can trigger.
    function executeX402Call(
        address service,
        address token,
        uint256 amount,
        uint256 threadId
    ) external onlyOwner nonReentrant whenNotPaused {
        uint256 day = currentDay();
        require(spentOnDay[day][token] + amount <= dailySpendCap[token], "CAP_EXCEEDED");
        spentOnDay[day][token] += amount;

        require(IERC20(token).transfer(service, amount), "TRANSFER_FAIL");

        emit X402PaymentMade(service, token, amount, threadId);
    }

    /// @notice Owner can withdraw tokens in emergency. Intentionally callable
    /// while paused — the kill-switch must not lock funds inside the wallet.
    function emergencyWithdraw(address token, uint256 amount, address to) external onlyOwner nonReentrant {
        require(IERC20(token).transfer(to, amount), "WITHDRAW_FAIL");
        emit EmergencyWithdraw(token, amount, to);
    }

    /// @notice Approve facilitator to pull up to `amount`. Disabled while paused.
    function approveFacilitator(address token, uint256 amount) external onlyOwner whenNotPaused {
        require(x402Facilitator != address(0), "NO_FACILITATOR");
        require(IERC20(token).approve(x402Facilitator, amount), "APPROVE_FAIL");
    }
}
