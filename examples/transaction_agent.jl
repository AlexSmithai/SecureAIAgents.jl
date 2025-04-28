using Sphinx

agent = create_signer_agent(1)
env = create_blockchain_env(1)
env["transaction"] = "send 1 BTC to Alice"

step!(agent, env)
