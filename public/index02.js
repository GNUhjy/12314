const socket = io();
let localStream;
let producerTransport;
let producer;
let device;
let consumers = [];
let isVideoEnabled = true;
let isAudioEnabled = true;

async function start() {
    // 로컬 비디오 스트림 가져오기
    try{
    
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('localVideo').srcObject = localStream;
    } catch (error){
        console.log("스트림 불러오기 실패")
    }

    // 서버에서 Router RTP Capabilities 요청
    socket.emit('getRouterRtpCapabilities', async (data) => {
        console.log('서버에 Rtp 정보 요청')

        try{
            device = new mediasoupClient.Device();
            console.log("디바이스 생성 완료")
            await device.load({ routerRtpCapabilities: data });
            console.log("디바이스 로드 완료");
        } catch(error){
            console.log("디바이스 생성 실패", error)
        }

        // Producer Transport 생성
        socket.emit('createProducerTransport', {}, async (transportData) => {
            producerTransport = device.createSendTransport(transportData);

            producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                socket.emit('connectProducerTransport', { dtlsParameters }, callback);
            });

            producerTransport.on('produce', async (parameters, callback, errback) => {
                socket.emit('produce', parameters, ({ id }) => {
                    callback({ id });
                });
                console.log(id)
            });

            // 로컬 스트림을 서버에 전송
            if(localStram){
                localStream.getTracks().forEach(track => {
                    producerTransport.produce({ track });
                });
            }
        });
    });
};

// 서버로부터 Consumer 생성 요청 처리
socket.on('newProducer', async ({ producerId, clientId }) => {
    console.log('새로운 클라이언트가 연결됨:', producerId);

    socket.emit('createConsumerTransport', {}, async (transportData) => {
        console.log('consumertransport data 받아옴:', transportData);
        const consumerTransport = device.createRecvTransport(transportData);
        
        consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            console.log('consumer 연결 완료')
            socket.emit('connectConsumerTransport', { dtlsParameters }, callback);
        });
        
        try {
            const consumer = await consumerTransport.consume({
                producerId,
                rtpCapabilities: device.rtpCapabilities
            });

            console.log('Consumer 생성됨 :', consumer.id);

            const remoteVideo = document.getElementById(clientId);
            if (!remoteVideo) {
                const videoWrapper = document.createElement('div');
                videoWrapper.id = clientId;
                videoWrapper.innerHTML = `<p>클라이언트 ${clientId}</p>`;
                const videoElement = document.createElement('video');
                videoElement.autoplay = true;
                videoElement.controls = true;
                videoElement.srcObject = new MediaStream([consumer.track]);
                videoWrapper.appendChild(videoElement);
                document.getElementById('remoteVideos').appendChild(videoWrapper);
            }

            consumers.push(consumer);
        } catch (error) {
            console.log(clientId, '의 미디어 가져오기 실패');
        }
    });
});

socket.on('newClient', ({ clientId }) => {
    const videoWrapper = document.createElement('div');
    videoWrapper.id = clientId;
    videoWrapper.innerHTML = `<p>클라이언트 ${clientId}</p>`;
    const videoElement = document.createElement('video');
    videoElement.autoplay = true;
    //videoElement.controls = true;
    videoElement.style.backgroundColor = 'black'; // 기본 검은색 배경
    videoElement.style.width = '300px'; // 비디오 크기 설정
    videoElement.style.height = '200px';
    videoWrapper.appendChild(videoElement);
    document.getElementById('remoteVideos').appendChild(videoWrapper);
});

socket.on('removeClient', ({ clientId }) => {
    const videoWrapper = document.getElementById(clientId);
    const consumerIndex = consumers.findIndex(c => c.id === clientId);
    if (videoWrapper) {
        videoWrapper.remove();
    }
    if (consumerIndex > -1) {
        consumers[consumerIndex].close();
        consumers.splice(consumerIndex, 1);
    }
});

// 카메라와 마이크 제어 기능
document.getElementById('toggleVideo').addEventListener('click', () => {
    isVideoEnabled = !isVideoEnabled;
    localStream.getVideoTracks().forEach(track => track.enabled = isVideoEnabled);
});

document.getElementById('toggleAudio').addEventListener('click', () => {
    isAudioEnabled = !isAudioEnabled;
    localStream.getAudioTracks().forEach(track => track.enabled = isAudioEnabled);
});

start();