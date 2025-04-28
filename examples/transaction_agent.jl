using SecureAIAgents

agent = AIAgent(1, "signer", random_voting_model)
env = create_blockchain_env(1)
env["transaction"] = "send 1 BTC to Alice"

step!(agent, env)
