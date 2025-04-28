using Test
using Sphinx

@testset "Sphinx Tests" begin
    agent = create_voter_agent(1, true)
    @test agent.id == 1
    @test agent.role == "voter"
    @test !isnothing(agent.nn_model)
    
    env = create_blockchain_env(1)
    @test env["block_height"] >= 0
    
    step!(agent, env)
    @test haskey(agent.state, "vote")
    @test haskey(agent.state, "tx_hash")
    
    result = call_tee_secure_function("test")
    @test result == "tset"
    
    block_height = read_blockchain_data()
    @test isa(block_height, Int)
    tx_hash = submit_transaction("test")
    @test startswith(tx_hash, "0x")
end
