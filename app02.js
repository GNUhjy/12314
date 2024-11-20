const fs = require('fs');
const https = require('https');
const express = require('express');
const socketIo = require('socket.io');
const mediasoup = require('mediasoup');
const http = require('http')

const app = express();

// HTTPS 서버 설정을 위해 인증서 경로
/*
const options = {
    key: fs.readFileSync('/etc/letsencrypt/live/webrtc.n-e.kr/privkey.pem'),  // 개인 키 파일
    cert: fs.readFileSync('/etc/letsencrypt/live/webrtc.n-e.kr/fullchain.pem') // 인증서 파일
};

const httpsServer = https.createServer(options, app);
const io = socketIo(httpsServer);
*/

const httpServer = http.createServer(app);
const io = socketIo(httpServer);

// Express로 기본 경로 설정
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index02.html');
    });

// HTTP 서버 실행 (포트 3000)
httpServer.listen(8080, () => {
    console.log('서버가 실행중');
});

let worker;
let router;
let transports = {}; // 클라이언트별 Transport 정보 저장
let producers = {}; // 클라이언트별 Producer 저장
let consumers = {}; // 클라이언트별 Consumer 저장

// Mediasoup Worker 생성 함수
async function createMediasoupWorker() {
    // Worker 생성
    try{
        worker = await mediasoup.createWorker({
            rtcMinPort: 10000,
            rtcMaxPort: 10100,  // WebRTC에서 사용할 최소 및 최대 포트 지정
        });

        console.log('워커 생성 완료');
    }catch(error){
        console.log("워커 생성 실패")
    }
    worker.on('died', () => {
        console.error('워커 삭제. 서버를 종료합니다.');
        process.exit(1);  // Worker가 죽으면 서버를 종료.
    });

    // Router 생성
    await createRouter();
}

// Mediasoup Router 생성 함수
async function createRouter() {
    // 미디어 코덱 설정
    const mediaCodecs = [
        {
            kind: 'audio',
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 2,
        },
        {
            kind: 'video',
            mimeType: 'video/VP8',
            clockRate: 90000,
        },
    ];
    try{
        router = await worker.createRouter({ mediaCodecs });
        console.log('라우터 생성 성공');
    }catch(error){
        console.log("라우터 생성 실패")
    }
}

createMediasoupWorker();

// 서버의 Socket.IO 이벤트 처리
io.on('connection', (socket) => {
    console.log('새로운 클라이언트 접속 :', socket.id);

    // 라우터의 RTP 정보를 콜백
    socket.on('getRouterRtpCapabilities', (callback) => {
        console.log("라우터 RTP정보 요청이 들어옴")
        try{
            callback(router.rtpCapabilities);
        } catch(error) {console.log('RTP 데이터 보내주기 실패')}
    });

    transports[socket.id] = { producerTransport: null, consumerTransports: [] };
    producers[socket.id] = [];
    consumers[socket.id] = [];

    // 기존의 모든 Producer 정보를 새 클라이언트에게 전달
    for (let clientId in producers) {
        producers[clientId].forEach(producer => {
            socket.emit('newProducer', { producerId: producer.id });
        });
    }

    // 클라이언트에게 빈 비디오 창을 생성하고 표시
    io.emit('newClient', { clientId: socket.id });

    // 처음 접속한 클라이언트의 Producer Transport 생성 요청 처리(최초 1번)
    socket.on('createProducerTransport', async (_, callback) => {
        console.log('클라이언트 ', socket.id, '가 transport 생성을 요청하였습니다.');

        try {
            if (!transports[socket.id]) {
                transports[socket.id] = { producerTransport: null, consumerTransports: [] };
            }
            const producerTransport = await router.createWebRtcTransport({
                listenIps: [{ ip: '0.0.0.0', announcedIp: 'localhost' }], // 공인 IP 설정 필요
                enableUdp: true,
                enableTcp: true,
            });

            transports[socket.id].producerTransport = producerTransport;

            console.log(socket.id, '클라이언트를 위한 transport 생성 완료.');

            callback({
                id: producerTransport.id,
                iceParameters: producerTransport.iceParameters,
                iceCandidates: producerTransport.iceCandidates,
                dtlsParameters: producerTransport.dtlsParameters,
            });
        } catch (error) {
            console.error('transport 생성 실패. 클라이언트 ', socket.id, ':', error);
            callback({ error: error.message });
        }
    });

    // 클라이언트가 ProducerTransport를 만들고 연결을 요청
    socket.on('connectProducerTransport', async ({ dtlsParameters }, callback) => {
        try {
            const producerTransport = transports[socket.id].producerTransport;
            if (!producerTransport) {
                throw new Error('해당 클라이언트에 연결된 producerTransport가 없습니다: ' + socket.id);
            }
    
            await producerTransport.connect({ dtlsParameters });
            callback();
        } catch (error) {
            console.error('connectProducerTransport 오류:', error);
            callback({ error: error.message });
        }
    });

    // 사용자가 미디어 스트림을 생성 (produce)
    socket.on('produce', async ({ kind, rtpParameters }, callback) => {
        console.log('클라이언트 ', socket.id, '가 미디어를 보냄, kind:', kind);

        try {
            const producerTransport = transports[socket.id].producerTransport;
            if (!producerTransport) {
                throw new Error('해당 클라이언트에 연결된 transport가 없습니다. ' + socket.id);
            }
            try{
                const producer = await producerTransport.produce({ kind, rtpParameters });
                producers[socket.id].push(producer);
                console.log(producer.id, 'Producer 가', socket.id, '의', kind, '을 받음');
            } catch(error){
                console.log('스트림 받기 실패')
            }
            // Producer ID를 클라이언트에게 전달
            callback({ id: producer.id });

            // 다른 모든 클라이언트에게 새로운 Producer가 생겼음을 알림
            socket.broadcast.emit('newProducer', { producerId: producer.id, clientId: socket.id });
        } catch (error) {
            console.error('Failed to produce for client', socket.id, ':', error);
            callback({ error: error.message });
        }
    });

    // Consumer Transport 생성 요청 처리
    socket.on('createConsumerTransport', async (_, callback) => {
        console.log('클라이언트', socket.id, '가 Consumer Transport 생성을 요청함');

        try {
            const consumerTransport = await router.createWebRtcTransport({
                listenIps: [{ ip: '0.0.0.0', announcedIp: '0.0.0.0' }], // 공인 IP 설정 필요
                enableUdp: true,
                enableTcp: true,
            });

            transports[socket.id].consumerTransports.push(consumerTransport);

            console.log(socket.id, '클라이언트에 해당하는 consumer 생성 완료');

            callback({
                id: consumerTransport.id,
                iceParameters: consumerTransport.iceParameters,
                iceCandidates: consumerTransport.iceCandidates,
                dtlsParameters: consumerTransport.dtlsParameters,
            });
        } catch (error) {
            console.error('Consumer Transport 생성 실패 client', socket.id, ':', error);
            callback({ error: error.message });
        }
    });

    // 사용자가 미디어를 소비 (consume)
    socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
        console.log('Client', socket.id, 'requested to consume producer:', producerId);

        try {
            if (!router.canConsume({ producerId, rtpCapabilities })) {
                throw new Error('Cannot consume the given producerId with provided capabilities');
            }

            const consumerTransport = transports[socket.id].consumerTransports[0];
            if (!consumerTransport) {
                throw new Error('No consumer transport found for client ' + socket.id);
            }

            const consumer = await consumerTransport.consume({
                producerId,
                rtpCapabilities,
            });

            console.log('Consumer created for client:', socket.id, 'Consumer ID:', consumer.id);

            consumers[socket.id].push(consumer);

            // Consumer 정보를 클라이언트에 전달
            callback({
                id: consumer.id,
                producerId,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters,
            });
        } catch (error) {
            console.error('Failed to consume for client', socket.id, ':', error);
            callback({ error: error.message });
        }
    });

    // 클라이언트가 연결을 종료할 때 처리
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);

        // 연결 해제 시 모든 관련 리소스 해제
        if (transports[socket.id]) {
            if (transports[socket.id].producerTransport) {
                transports[socket.id].producerTransport.close();
            }
            transports[socket.id].consumerTransports.forEach(transport => transport.close());
        }

        producers[socket.id].forEach(producer => producer.close());
        consumers[socket.id].forEach(consumer => consumer.close());

        delete transports[socket.id];
        delete producers[socket.id];
        delete consumers[socket.id];

        // 모든 클라이언트에게 연결 해제된 클라이언트의 비디오를 제거하라고 알림
        io.emit('removeClient', { clientId: socket.id });
    });
});