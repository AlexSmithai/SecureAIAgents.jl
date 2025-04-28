module Sphinx
using Random
using Flux
using Libdl
using HTTP
using JSON
using Sockets
include("sphinx_cli/cli.jl")
include("sphinx_core/core.jl")
include("sphinx_engine/engine.jl")
include("sphinx_server/server.jl")
include("sphinx_web3/web3.jl")
include("tools/web3_tools.jl")
include("agents/voter_agent.jl")
include("agents/signer_agent.jl")
include("agents/reader_agent.jl")
export AIAgent, NeuralNetModel, step!, create_blockchain_env, update_environment!, read_blockchain_data, submit_transaction, submit_vote_to_contract, run_server
end
