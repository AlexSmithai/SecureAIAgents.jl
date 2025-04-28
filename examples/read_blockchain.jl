using Sphinx

agent = create_reader_agent(1)
env = create_blockchain_env(1)

step!(agent, env)
